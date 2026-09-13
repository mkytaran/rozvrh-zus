const GOOGLE_APP_URL = "https://script.google.com/macros/s/AKfycbzbn-loEtgL8Q96wbLrqR9Jluff6YSdmnVxnjnmULq0OMTAsFgjAaEjn77hw66aqjel/exec";

// --- 1. PIN a autentizace ---
let appPin = localStorage.getItem('zus_pin');
if (!appPin || appPin === "null" || appPin === "") {
    appPin = prompt("Zadejte tajný PIN pro přístup k rozvrhu:");
    if (appPin) localStorage.setItem('zus_pin', appPin.trim());
}

// --- 2. Datový model: Kmenový rozvrh (Master) + Týdenní přepisy (Overrides) ---
const defaultMaster = {
    "Pondělí": [], "Úterý": [], "Středa": [], "Čtvrtek": [], "Pátek": []
};

let masterSchedule = defaultMaster;
let weekOverrides = {}; // Formát: { "2026-W38": { "Pondělí_13:45": { absent: true, ... } } }

// Načtení lokálního stavu se zpětnou kompatibilitou
(function loadLocalState() {
    const rawMaster = localStorage.getItem('zus_master_schedule') || localStorage.getItem('zus_schedule');
    if (rawMaster) {
        try {
            const parsed = JSON.parse(rawMaster);
            if (parsed && typeof parsed === 'object') masterSchedule = parsed;
        } catch (e) {
            console.error("Chyba čtení kmenového rozvrhu:", e);
        }
    }

    const rawOverrides = localStorage.getItem('zus_week_overrides');
    if (rawOverrides) {
        try {
            weekOverrides = JSON.parse(rawOverrides) || {};
        } catch (e) {
            weekOverrides = {};
        }
    }
})();

// --- 3. Časový stav a navigace ---
let weekOffset = 0; // 0 = aktuální týden, 1 = příští, -1 = minulý...
const workDays = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'];
const dayMap = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];

const systemNow = new Date();
let currentDay = (systemNow.getDay() >= 1 && systemNow.getDay() <= 5) ? dayMap[systemNow.getDay()] : 'Pondělí';

let swapSourceIndex = null;
let editingIndex = null;
let playedChordForTime = null;

// --- 4. Kalendářní a časové kalkulace ---
function getMonday(d, offsetWeeks = 0) {
    const date = new Date(d);
    const day = date.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    date.setDate(date.getDate() + diff + (offsetWeeks * 7));
    date.setHours(0, 0, 0, 0);
    return date;
}

function getISOWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function getDateForDay(targetDayName, offsetWeeks = weekOffset) {
    const monday = getMonday(new Date(), offsetWeeks);
    const dayIndices = { 'Pondělí': 0, 'Úterý': 1, 'Středa': 2, 'Čtvrtek': 3, 'Pátek': 4 };
    const date = new Date(monday);
    date.setDate(monday.getDate() + (dayIndices[targetDayName] || 0));
    return date;
}

function addMinutes(timeStr, mins) {
    if (!timeStr || !timeStr.includes(':')) return "00:00";
    let [h, m] = timeStr.split(':').map(Number);
    let d = new Date(2000, 0, 1, h, m + mins);
    return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0');
}

function timeToMinutes(timeStr) {
    if (!timeStr || !timeStr.includes(':')) return 0;
    let [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
}

function getGenderClass(name) {
    if (!name) return '';
    const clean = name.trim().toLowerCase();
    if (clean.includes('soubor') || clean.includes('soukr') || clean.includes('hodina')) return '';
    if (clean.endsWith('ová') || /\b\w+ová\b/.test(clean)) return 'gender-girl';
    return 'gender-boy';
}

function parseSingleDate(str) {
    if (!str) return null;
    const parts = str.trim().split('.').map(p => parseInt(p.trim())).filter(p => !isNaN(p));
    if (parts.length < 2) return null;
    const day = parts[0];
    const month = parts[1] - 1;
    const year = parts.length >= 3 ? (parts[2] < 100 ? 2000 + parts[2] : parts[2]) : new Date().getFullYear();
    const d = new Date(year, month, day);
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
}

function isLessonAbsentInDate(lesson, targetDate) {
    if (!lesson.absent) return false;
    if (!lesson.absentDate || !lesson.absentDate.trim()) return true;

    const dateStr = lesson.absentDate.trim();
    if (dateStr.includes('-')) {
        const [startPart, endPart] = dateStr.split('-');
        const startDate = parseSingleDate(startPart);
        const endDate = parseSingleDate(endPart);
        if (startDate && endDate) return targetDate >= startDate && targetDate <= endDate;
        if (endDate) return targetDate <= endDate;
    }

    const singleDate = parseSingleDate(dateStr);
    if (singleDate) return targetDate.getTime() === singleDate.getTime();
    return true;
}

// --- 5. Web Audio API (Kytarový akord Eadd9) ---
function playGuitarChord() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const freqs = [82.41, 123.47, 164.81, 207.65, 369.99];

        freqs.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);

            const start = ctx.currentTime + (idx * 0.045);
            gain.gain.setValueAtTime(0.0001, start);
            gain.gain.exponentialRampToValueAtTime(0.28, start + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, start + 2.8);

            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start);
            osc.stop(start + 3.0);
        });
    } catch (e) {
        console.log("Audio čeká na první interakci uživatele.");
    }
}

// --- 6. Sloučení kmenových dat a týdenních výjimek ---
function getEffectiveDayLessons(dayName) {
    const rawLessons = masterSchedule[dayName] || [];
    const activeMonday = getMonday(new Date(), weekOffset);
    const isoKey = getISOWeekKey(activeMonday);
    const overrides = weekOverrides[isoKey] || {};
    const targetDayDate = getDateForDay(dayName, weekOffset);

    return rawLessons.map(lesson => {
        const key = `${dayName}_${lesson.time}`;
        const override = overrides[key] || {};

        const merged = {
            ...lesson,
            name: override.name !== undefined ? override.name : lesson.name,
            rocnik: override.rocnik !== undefined ? override.rocnik : lesson.rocnik,
            hn: override.hn !== undefined ? override.hn : lesson.hn,
            absent: override.absent !== undefined ? override.absent : lesson.absent,
            absentDate: override.absentDate !== undefined ? override.absentDate : lesson.absentDate,
            substitute: override.substitute !== undefined ? override.substitute : lesson.substitute,
            isPrivate: override.isPrivate !== undefined ? override.isPrivate : lesson.isPrivate,
            notes: override.notes !== undefined ? override.notes : lesson.notes,
            ensemble: override.ensemble !== undefined ? override.ensemble : lesson.ensemble,
            ensembleGroup: override.ensembleGroup !== undefined ? override.ensembleGroup : lesson.ensembleGroup
        };

        merged.isAbsentCalculated = isLessonAbsentInDate(merged, targetDayDate);
        return merged;
    }).sort((a, b) => a.time.localeCompare(b.time));
}

// --- 7. Vykreslování rozhraní ---
function updateWeekStepperUI() {
    const monday = getMonday(new Date(), weekOffset);
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    const titleEl = document.getElementById('week-label-title');
    const rangeEl = document.getElementById('week-range-subtitle');
    const btnToday = document.getElementById('btn-today');

    if (weekOffset === 0) {
        if (titleEl) titleEl.textContent = 'Tento týden';
        if (btnToday) btnToday.classList.add('hidden');
    } else if (weekOffset === 1) {
        if (titleEl) titleEl.textContent = 'Příští týden';
        if (btnToday) btnToday.classList.remove('hidden');
    } else if (weekOffset === -1) {
        if (titleEl) titleEl.textContent = 'Minulý týden';
        if (btnToday) btnToday.classList.remove('hidden');
    } else if (weekOffset > 1) {
        if (titleEl) titleEl.textContent = `Za ${weekOffset} týdny`;
        if (btnToday) btnToday.classList.remove('hidden');
    } else {
        if (titleEl) titleEl.textContent = `Před ${Math.abs(weekOffset)} týdny`;
        if (btnToday) btnToday.classList.remove('hidden');
    }

    if (rangeEl) {
        rangeEl.textContent = `${monday.getDate()}. ${monday.getMonth() + 1}. – ${friday.getDate()}. ${friday.getMonth() + 1}. ${friday.getFullYear()}`;
    }
}

function renderTabs() {
    const dayShortNames = { 'Pondělí': 'Po', 'Úterý': 'Út', 'Středa': 'St', 'Čtvrtek': 'Čt', 'Pátek': 'Pá' };

    document.querySelectorAll('.day-selector button').forEach(btn => {
        const dayName = btn.dataset.day;
        btn.classList.toggle('active', dayName === currentDay);

        const dayDate = getDateForDay(dayName, weekOffset);
        const nameSpan = btn.querySelector('.tab-day-name');
        const dateSpan = btn.querySelector('.tab-day-date');

        if (nameSpan) nameSpan.textContent = dayShortNames[dayName] || dayName.slice(0, 2);
        if (dateSpan) dateSpan.textContent = `${dayDate.getDate()}.${dayDate.getMonth() + 1}.`;

        btn.onclick = () => {
            const oldIdx = workDays.indexOf(currentDay);
            const newIdx = workDays.indexOf(dayName);
            const dir = newIdx > oldIdx ? 'right' : (newIdx < oldIdx ? 'left' : '');
            currentDay = dayName;
            swapSourceIndex = null;
            renderTabs();
            renderSchedule(dir);
        };
    });
}

function renderSchedule(animDir = '') {
    const container = document.getElementById('schedule-container');
    container.classList.remove('slide-from-right', 'slide-from-left');
    void container.offsetWidth;
    if (animDir === 'right') container.classList.add('slide-from-right');
    if (animDir === 'left') container.classList.add('slide-from-left');

    container.innerHTML = '';
    const dayData = getEffectiveDayLessons(currentDay);

    const now = new Date();
    const isCurrentRealWeek = (weekOffset === 0);
    const isToday = isCurrentRealWeek && (dayMap[now.getDay()] === currentDay);
    const currentMins = now.getHours() * 60 + now.getMinutes();

    dayData.forEach((lesson, index) => {
        const startMins = timeToMinutes(lesson.time);
        const endMins = startMins + 45;
        const endTime = addMinutes(lesson.time, 45);

        const isAbsent = !!lesson.isAbsentCalculated;
        const hasSub = isAbsent && lesson.substitute;
        const isPrivate = lesson.isPrivate || (lesson.name && lesson.name.toLowerCase().includes('soukr'));
        const isEnsemble = lesson.ensemble || (lesson.name && lesson.name.toLowerCase().includes('kytarový soubor'));

        let stripeClass = '';
        let ensembleTitleClass = '';

        if (isPrivate) {
            stripeClass = 'private-card';
        } else if (isEnsemble) {
            const isBlock = lesson.name && lesson.name.toLowerCase().includes('kytarový soubor');
            if (isBlock) {
                if (lesson.ensembleGroup === 'younger') {
                    stripeClass = 'ensemble-purple';
                    ensembleTitleClass = 'ensemble-title-younger';
                } else {
                    stripeClass = 'ensemble-gold';
                    ensembleTitleClass = 'ensemble-title-older';
                }
            } else {
                const rocnikNum = parseInt(lesson.rocnik);
                stripeClass = (!isNaN(rocnikNum) && rocnikNum >= 5) ? 'ensemble-gold' : 'ensemble-purple';
            }
        }

        let timeStatusClass = '';
        let progressPercent = 0;

        if (isToday) {
            if (currentMins >= endMins) {
                timeStatusClass = 'past-lesson';
            } else if (currentMins >= startMins && currentMins < endMins) {
                timeStatusClass = 'current-lesson';
                const elapsed = currentMins - startMins;
                progressPercent = Math.min(100, Math.round((elapsed / 45) * 100));

                if (elapsed === 40 && playedChordForTime !== `${currentDay}-${lesson.time}`) {
                    playedChordForTime = `${currentDay}-${lesson.time}`;
                    playGuitarChord();
                }
            }
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'lesson-card-wrapper';

        const card = document.createElement('div');
        card.className = `lesson-card ${swapSourceIndex === index ? 'swap-mode' : ''} ${isAbsent ? 'absent' : ''} ${hasSub ? 'has-substitute' : ''} ${stripeClass} ${timeStatusClass}`;

        if (timeStatusClass === 'current-lesson') {
            card.style.opacity = (1 - (progressPercent / 100) * 0.45).toFixed(2);
        }

        let detailsHtml = '';
        if (isPrivate) {
            detailsHtml = `<span style="color: #60a5fa; font-weight: 500;">Soukromá lekce</span>`;
            if (lesson.notes) detailsHtml += `<div class="private-notes-preview">📝 ${lesson.notes}</div>`;
        } else {
            let tags = [];
            if (lesson.rocnik) tags.push(`Roč: <span>${lesson.rocnik}</span>`);
            if (lesson.hn) tags.push(`HN: <span>${lesson.hn}</span>`);
            if (isEnsemble && !lesson.name.toLowerCase().includes('kytarový soubor')) {
                const color = stripeClass === 'ensemble-purple' ? '#c084fc' : '#ffd166';
                tags.push(`<span style="color: ${color}; font-weight: 600;">🎸 Soubor</span>`);
            }
            detailsHtml = tags.join(' | ');
        }

        const absentBadge = isAbsent ? `<span class="badge-absent">Omluvenka${lesson.absentDate ? ` (${lesson.absentDate})` : ''}</span>` : '';

        card.innerHTML = `
            <div class="time-col">
                <div>${lesson.time}</div>
                <div class="end-time">${endTime}</div>
            </div>
            <div class="info-col">
                <div class="student-name ${getGenderClass(lesson.name)} ${ensembleTitleClass}">
                    ${lesson.name} ${absentBadge}
                </div>
                <div class="student-details">${detailsHtml}</div>
            </div>
            ${timeStatusClass === 'current-lesson' ? `<div class="lesson-progress-bar" style="width: ${progressPercent}%;"></div>` : ''}
        `;

        card.onclick = () => handleCardClick(index);
        wrapper.appendChild(card);

        if (hasSub) {
            const subCard = document.createElement('div');
            subCard.className = 'substitute-badge-card';
            subCard.innerHTML = `
                <div>
                    <div class="sub-title">↳ Záskok v ${lesson.time}</div>
                    <div class="sub-name ${getGenderClass(lesson.substitute)}">${lesson.substitute}</div>
                </div>
                <div class="sub-tag">Zástup</div>
            `;
            subCard.onclick = () => handleCardClick(index);
            wrapper.appendChild(subCard);
        }

        container.appendChild(wrapper);
    });
}

// --- 8. Ukládání dat a cloudová synchronizace ---
function saveSchedule(newPrivateNote = null) {
    localStorage.setItem('zus_master_schedule', JSON.stringify(masterSchedule));
    localStorage.setItem('zus_week_overrides', JSON.stringify(weekOverrides));

    const payload = {
        master: masterSchedule,
        overrides: weekOverrides,
        newPrivateNote: newPrivateNote
    };

    fetch(GOOGLE_APP_URL + "?pin=" + encodeURIComponent(appPin), {
        method: 'POST',
        body: JSON.stringify(payload)
    }).then(() => console.log("Úspěšná cloudová synchronizace"))
      .catch(err => console.error("Chyba synchronizace", err));
}

function fetchCloudSchedule(silent = true) {
    if (!appPin) return;

    fetch(GOOGLE_APP_URL + "?pin=" + encodeURIComponent(appPin))
        .then(res => {
            if (res.status === 200) return res.text();
            throw new Error("Chyba spojení");
        })
        .then(text => {
            if (text.includes("Přístup odepřen")) {
                if (!silent) alert("Špatný PIN.");
                return;
            }
            const data = JSON.parse(text);
            if (data.master || data["Pondělí"]) {
                masterSchedule = data.master || data;
                if (data.overrides) weekOverrides = data.overrides;

                localStorage.setItem('zus_master_schedule', JSON.stringify(masterSchedule));
                localStorage.setItem('zus_week_overrides', JSON.stringify(weekOverrides));

                renderTabs();
                renderSchedule();
                if (!silent) alert("Rozvrh byl úspěšně synchronizován.");
            }
        })
        .catch(() => {
            if (!silent) alert("Nepodařilo se připojit k tabulce. Pracujete v offline režimu.");
        });
}

// --- 9. Správa úprav a dialogu ---
function populateSubstituteSelect(currentLessonStudent) {
    const select = document.getElementById('substitute-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Vyberte stálého žáka --</option>';

    const allStudents = new Set();
    for (let day in masterSchedule) {
        (masterSchedule[day] || []).forEach(l => {
            if (l.name && l.name !== currentLessonStudent) allStudents.add(l.name);
        });
    }
    Array.from(allStudents).sort().forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        select.appendChild(opt);
    });
}

function handleCardClick(index) {
    const effectiveLessons = getEffectiveDayLessons(currentDay);

    // Jednorázová výměna žáků ve vybraném týdnu
    if (swapSourceIndex !== null) {
        if (swapSourceIndex !== index) {
            const activeMonday = getMonday(new Date(), weekOffset);
            const isoKey = getISOWeekKey(activeMonday);
            if (!weekOverrides[isoKey]) weekOverrides[isoKey] = {};

            const lessonA = effectiveLessons[swapSourceIndex];
            const lessonB = effectiveLessons[index];

            weekOverrides[isoKey][`${currentDay}_${lessonA.time}`] = {
                name: lessonB.name, rocnik: lessonB.rocnik, hn: lessonB.hn, ensemble: lessonB.ensemble
            };
            weekOverrides[isoKey][`${currentDay}_${lessonB.time}`] = {
                name: lessonA.name, rocnik: lessonA.rocnik, hn: lessonA.hn, ensemble: lessonA.ensemble
            };

            saveSchedule();
        }
        swapSourceIndex = null;
        renderSchedule();
        return;
    }

    editingIndex = index;
    const lesson = effectiveLessons[index];

    document.getElementById('edit-time').value = lesson.time;
    const nameInput = document.getElementById('edit-name');
    nameInput.value = lesson.name;
    document.getElementById('edit-rocnik').value = lesson.rocnik || '';
    document.getElementById('edit-hn').value = lesson.hn || '';
    document.getElementById('edit-notes').value = lesson.notes || '';

    const editPrivate = document.getElementById('edit-private');
    editPrivate.checked = !!lesson.isPrivate || (lesson.name && lesson.name.toLowerCase().includes('soukr'));

    const stdFields = document.getElementById('standard-zus-fields');
    const privFields = document.getElementById('private-lesson-fields');
    const ensembleSelector = document.getElementById('ensemble-group-selector');
    const radYounger = document.getElementById('ensemble-younger');
    const radOlder = document.getElementById('ensemble-older');

    function updateModalFields() {
        if (editPrivate.checked) {
            stdFields.style.display = 'none';
            privFields.style.display = 'block';
            if (ensembleSelector) ensembleSelector.style.display = 'none';
        } else {
            stdFields.style.display = 'block';
            privFields.style.display = 'none';
            const isEnsembleBlock = nameInput.value.toLowerCase().includes('kytarový soubor');
            if (ensembleSelector) ensembleSelector.style.display = isEnsembleBlock ? 'block' : 'none';
        }
    }

    editPrivate.onchange = updateModalFields;
    nameInput.oninput = updateModalFields;
    updateModalFields();

    if (radYounger && radOlder) {
        if (lesson.ensembleGroup === 'younger') radYounger.checked = true;
        else radOlder.checked = true;
    }

    document.getElementById('edit-ensemble').checked = !!lesson.ensemble;

    // Omluvenky a záskok
    const editAbsentCheckbox = document.getElementById('edit-absent');
    const absentDateContainer = document.getElementById('absent-date-container');
    const editAbsentDateInput = document.getElementById('edit-absent-date');
    const subSection = document.getElementById('substitute-section');
    const subCustom = document.getElementById('substitute-custom');
    const subSelect = document.getElementById('substitute-select');

    populateSubstituteSelect(lesson.name);
    editAbsentCheckbox.checked = !!lesson.absent;
    editAbsentDateInput.value = lesson.absentDate || '';
    subCustom.value = lesson.substitute || '';
    subSelect.value = '';

    const toggleAbsent = () => {
        const isAbs = editAbsentCheckbox.checked;
        if (absentDateContainer) absentDateContainer.style.display = isAbs ? 'block' : 'none';
        if (subSection) subSection.style.display = isAbs ? 'block' : 'none';
    };
    editAbsentCheckbox.onchange = toggleAbsent;
    toggleAbsent();

    document.getElementById('btn-clear-sub').onclick = () => {
        subCustom.value = '';
        subSelect.value = '';
    };
    subSelect.onchange = () => { if (subSelect.value) subCustom.value = subSelect.value; };

    document.getElementById('edit-modal').classList.remove('hidden');
}

document.getElementById('btn-cancel').onclick = () => document.getElementById('edit-modal').classList.add('hidden');

document.getElementById('btn-save').onclick = () => {
    if (editingIndex !== null) {
        const isPriv = document.getElementById('edit-private').checked;
        const newTime = document.getElementById('edit-time').value;
        const newName = document.getElementById('edit-name').value.trim();
        const isAbs = document.getElementById('edit-absent').checked;
        const absDate = isAbs ? document.getElementById('edit-absent-date').value.trim() : '';
        const subVal = document.getElementById('substitute-custom').value.trim();

        // 1. Uložení týdenní odchylky pro zobrazený týden
        const activeMonday = getMonday(new Date(), weekOffset);
        const isoKey = getISOWeekKey(activeMonday);
        if (!weekOverrides[isoKey]) weekOverrides[isoKey] = {};

        const key = `${currentDay}_${newTime}`;
        weekOverrides[isoKey][key] = {
            absent: isAbs,
            absentDate: absDate,
            substitute: (isAbs && subVal) ? subVal : ''
        };

        // 2. Úprava kmenového záznamu
        let privateNotePayload = null;
        const masterLessons = masterSchedule[currentDay] || [];
        if (masterLessons[editingIndex]) {
            masterLessons[editingIndex].time = newTime;
            masterLessons[editingIndex].name = newName;
            masterLessons[editingIndex].isPrivate = isPriv;

            if (isPriv) {
                const notesVal = document.getElementById('edit-notes').value.trim();
                masterLessons[editingIndex].notes = notesVal;
                masterLessons[editingIndex].rocnik = '';
                masterLessons[editingIndex].hn = '';
                masterLessons[editingIndex].ensemble = false;

                if (notesVal) {
                    privateNotePayload = { day: currentDay, time: newTime, name: newName, notes: notesVal };
                }
            } else {
                masterLessons[editingIndex].rocnik = document.getElementById('edit-rocnik').value.trim();
                masterLessons[editingIndex].hn = document.getElementById('edit-hn').value.trim();
                masterLessons[editingIndex].ensemble = document.getElementById('edit-ensemble').checked;
                masterLessons[editingIndex].notes = '';

                const radYounger = document.getElementById('ensemble-younger');
                masterLessons[editingIndex].ensembleGroup = (radYounger && radYounger.checked) ? 'younger' : 'older';
            }
        }

        saveSchedule(privateNotePayload);
        renderSchedule();
    }
    document.getElementById('edit-modal').classList.add('hidden');
};

document.getElementById('btn-swap').onclick = () => {
    swapSourceIndex = editingIndex;
    document.getElementById('edit-modal').classList.add('hidden');
    renderSchedule();
};

document.getElementById('btn-delete').onclick = () => {
    if (confirm('Opravdu chcete tuto hodinu smazat z rozvrhu?')) {
        (masterSchedule[currentDay] || []).splice(editingIndex, 1);
        saveSchedule();
        renderSchedule();
        document.getElementById('edit-modal').classList.add('hidden');
    }
};

document.getElementById('add-lesson-btn').onclick = () => {
    const list = masterSchedule[currentDay] || [];
    let defaultTime = "13:00";
    if (list.length > 0) defaultTime = addMinutes(list[list.length - 1].time, 45);

    const timeInput = prompt("Čas začátku nové hodiny (HH:MM):", defaultTime);
    if (!timeInput) return;
    const nameInput = prompt("Jméno žáka / Název hodiny:");
    if (nameInput === null) return;

    list.push({ time: timeInput, name: nameInput || "Nový žák", rocnik: "", hn: "", ensemble: false, notes: "", absent: false, absentDate: "" });
    saveSchedule();
    renderSchedule();
};

document.getElementById('add-break-btn').onclick = () => {
    const targetTime = prompt("Od jakého času posunout následující hodiny (HH:MM)?", "15:15");
    if (!targetTime) return;
    const duration = prompt("Kolik minut má pauza trvat?", "5");
    const mins = parseInt(duration);
    if (isNaN(mins)) return;

    (masterSchedule[currentDay] || []).forEach(lesson => {
        if (lesson.time >= targetTime) lesson.time = addMinutes(lesson.time, mins);
    });
    saveSchedule();
    renderSchedule();
};

// --- 10. Uživatelské vstupy: Šipky, Kalendář, Gesta, Dnes ---
const prevBtn = document.getElementById('week-prev');
if (prevBtn) {
    prevBtn.onclick = () => {
        weekOffset--;
        updateWeekStepperUI();
        renderTabs();
        renderSchedule('left');
    };
}

const nextBtn = document.getElementById('week-next');
if (nextBtn) {
    nextBtn.onclick = () => {
        weekOffset++;
        updateWeekStepperUI();
        renderTabs();
        renderSchedule('right');
    };
}

const btnToday = document.getElementById('btn-today');
if (btnToday) {
    btnToday.onclick = () => {
        weekOffset = 0;
        const now = new Date();
        currentDay = (now.getDay() >= 1 && now.getDay() <= 5) ? dayMap[now.getDay()] : 'Pondělí';
        updateWeekStepperUI();
        renderTabs();
        renderSchedule();
    };
}

// Výběr týdne z nativního kalendáře
const datePicker = document.getElementById('native-date-picker');
const weekTrigger = document.getElementById('week-trigger');

if (weekTrigger && datePicker) {
    weekTrigger.onclick = () => {
        if (datePicker.showPicker) {
            datePicker.showPicker();
        } else {
            datePicker.click();
        }
    };

    datePicker.onchange = (e) => {
        if (!e.target.value) return;
        const chosen = new Date(e.target.value);
        const currMonday = getMonday(new Date(), 0);
        const chosenMonday = getMonday(chosen, 0);

        weekOffset = Math.round((chosenMonday - currMonday) / (7 * 24 * 60 * 60 * 1000));
        const targetDayName = dayMap[chosen.getDay()];
        if (workDays.includes(targetDayName)) currentDay = targetDayName;

        updateWeekStepperUI();
        renderTabs();
        renderSchedule();
    };
}

document.getElementById('btn-sync').onclick = () => {
    if (navigator.vibrate) navigator.vibrate(50);
    fetchCloudSchedule(false);
};

// Swipe gesta pro přechod mezi dny
let touchStartX = 0;
let touchEndX = 0;

document.addEventListener('touchstart', e => {
    if (!document.getElementById('edit-modal').classList.contains('hidden')) return;
    touchStartX = e.changedTouches[0].screenX;
}, { passive: true });

document.addEventListener('touchend', e => {
    if (!document.getElementById('edit-modal').classList.contains('hidden')) return;
    touchEndX = e.changedTouches[0].screenX;

    const idx = workDays.indexOf(currentDay);
    if (idx === -1) return;

    if (touchEndX < touchStartX - 60 && idx < workDays.length - 1) {
        currentDay = workDays[idx + 1];
        renderTabs();
        renderSchedule('right');
    }
    if (touchEndX > touchStartX + 60 && idx > 0) {
        currentDay = workDays[idx - 1];
        renderTabs();
        renderSchedule('left');
    }
}, { passive: true });

// Automatická aktualizace stavu aktuální hodiny každou minutu
setInterval(() => {
    if (weekOffset === 0) renderSchedule();
}, 60000);

// --- Inicializace aplikace ---
updateWeekStepperUI();
renderTabs();
renderSchedule();
fetchCloudSchedule(true);