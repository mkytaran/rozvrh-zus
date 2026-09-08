const GOOGLE_APP_URL = "https://script.google.com/macros/s/AKfycbzbn-loEtgL8Q96wbLrqR9Jluff6YSdmnVxnjnmULq0OMTAsFgjAaEjn77hw66aqjel/exec";

// --- 1. PIN a autentizace ---
let appPin = localStorage.getItem('zus_pin');

if (!appPin || appPin === "null" || appPin === "") {
    appPin = prompt("Zadejte tajný PIN pro přístup k rozvrhu:");
    if (appPin) {
        localStorage.setItem('zus_pin', appPin.trim());
    }
}

// --- 2. Bezpečná prázdná kostra ---
const defaultSchedule = {
  "Pondělí": [],
  "Úterý": [],
  "Středa": [],
  "Čtvrtek": [],
  "Pátek": []
};

// --- 3. Načtení z paměti telefonu a inicializace ---
let savedSchedule = JSON.parse(localStorage.getItem('zus_schedule'));
let schedule = (savedSchedule && typeof savedSchedule === 'object') ? savedSchedule : defaultSchedule;

let currentDay = '';
let swapSourceIndex = null;
let editingIndex = null;
let playedChordForTime = null;

const workDays = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'];
const dayMap = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
const today = new Date().getDay();
currentDay = (today >= 1 && today <= 5) ? dayMap[today] : 'Pondělí';

// --- 4. Cloudová synchronizace ---
function fetchCloudSchedule(silent = true) {
    if (!appPin) return;

    fetch(GOOGLE_APP_URL + "?pin=" + encodeURIComponent(appPin))
        .then(res => {
            if (res.status === 200) return res.text();
            throw new Error("Chyba spojení");
        })
        .then(text => {
            if (text.includes("Přístup odepřen")) {
                alert("Špatný PIN. Nastavte prosím správný PIN.");
                localStorage.removeItem('zus_pin');
                location.reload();
                return;
            }

            const data = JSON.parse(text);
            const hasData = Object.values(data).some(arr => Array.isArray(arr) && arr.length > 0);

            if (hasData) {
                schedule = data;
                localStorage.setItem('zus_schedule', JSON.stringify(schedule));
                renderSchedule();
                if (!silent) alert("Rozvrh byl úspěšně synchronizován.");
            } else if (!silent) {
                alert("V tabulce zatím nejsou žádná data.");
            }
        })
        .catch(() => {
            if (!silent) alert("Nepodařilo se připojit k tabulce. Pracujete v offline režimu.");
        });
}

function saveSchedule(newPrivateNote = null) {
    localStorage.setItem('zus_schedule', JSON.stringify(schedule));

    const payload = { ...schedule };
    if (newPrivateNote) {
        payload.newPrivateNote = newPrivateNote;
    }

    fetch(GOOGLE_APP_URL + "?pin=" + encodeURIComponent(appPin), {
        method: 'POST',
        body: JSON.stringify(payload)
    }).then(() => {
        console.log("Úspěšně uloženo do tabulky");
    }).catch(err => {
        console.error("Uloženo lokálně, online synchronizace selhala:", err);
    });
}

document.getElementById('btn-sync').onclick = () => {
    if (navigator.vibrate) navigator.vibrate(50);
    fetchCloudSchedule(false);
};

// --- 5. Pomocné funkce: Čas, Pohlaví, Zvuk, Omluvenky ---
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

function playGuitarChord() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        const ctx = new AudioContext();
        const chordFreqs = [82.41, 123.47, 164.81, 207.65, 369.99]; 

        chordFreqs.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();

            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, ctx.currentTime);

            const startTime = ctx.currentTime + (i * 0.045);
            gain.gain.setValueAtTime(0.0001, startTime);
            gain.gain.exponentialRampToValueAtTime(0.28, startTime + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 2.8);

            osc.connect(gain);
            gain.connect(ctx.destination);

            osc.start(startTime);
            osc.stop(startTime + 3.0);
        });
    } catch (e) {
        console.log("Audio čeká na první interakci.");
    }
}

// --- LOGIKA KONTROLY DAT OMLUVENKY ---
// Vrátí datum pro daný den v aktuálním týdnu (s časem 00:00:00)
function getDateForDayInCurrentWeek(targetDayName) {
    const dayIndices = { 'Pondělí': 1, 'Úterý': 2, 'Středa': 3, 'Čtvrtek': 4, 'Pátek': 5 };
    const targetIdx = dayIndices[targetDayName] || 1;
    
    const now = new Date();
    const currentWeekDay = now.getDay() === 0 ? 7 : now.getDay(); // 1 = Po, 7 = Ne
    const diff = targetIdx - currentWeekDay;
    
    const targetDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
    targetDate.setHours(0, 0, 0, 0);
    return targetDate;
}

// Převede český řetězec data ("15.9." nebo "15.9.2026") na Date objekt
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

// Zjistí, zda je žák platně omluven pro konkrétní den v tomto týdnu
function isLessonAbsentThisWeek(lesson, dayName) {
    if (!lesson.absent) return false;
    // Pokud je zaškrtnuto "Omluven", ale není vyplněno datum, považujeme za omluveného
    if (!lesson.absentDate || !lesson.absentDate.trim()) return true;

    const targetDate = getDateForDayInCurrentWeek(dayName);
    const dateStr = lesson.absentDate.trim();

    // Rozsah s pomlčkou (např. "10.9. - 24.9.")
    if (dateStr.includes('-')) {
        const [startPart, endPart] = dateStr.split('-');
        const startDate = parseSingleDate(startPart);
        const endDate = parseSingleDate(endPart);

        if (startDate && endDate) {
            return targetDate >= startDate && targetDate <= endDate;
        } else if (endDate) {
            return targetDate <= endDate;
        }
    }

    // Jedno datum (např. "15.9.")
    const singleDate = parseSingleDate(dateStr);
    if (singleDate) {
        return targetDate.getTime() === singleDate.getTime();
    }

    return true;
}

// --- 6. Vykreslování rozvrhu ---
function renderTabs() {
    document.querySelectorAll('.day-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.day === currentDay);
        btn.onclick = () => {
            const oldIndex = workDays.indexOf(currentDay);
            const newIndex = workDays.indexOf(btn.dataset.day);
            let animDir = newIndex > oldIndex ? 'right' : (newIndex < oldIndex ? 'left' : '');

            currentDay = btn.dataset.day;
            swapSourceIndex = null;
            renderTabs();
            renderSchedule(animDir);
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

    let dayData = schedule[currentDay] || [];
    dayData.sort((a, b) => a.time.localeCompare(b.time));

    const now = new Date();
    const isToday = dayMap[now.getDay()] === currentDay;
    const currentMins = now.getHours() * 60 + now.getMinutes();

    dayData.forEach((lesson, index) => {
        const startMins = timeToMinutes(lesson.time);
        const endMins = startMins + 45;
        const endTime = addMinutes(lesson.time, 45);

        // Automatická kontrola platnosti omluvenky pro aktuální týden
        const isAbsentNow = isLessonAbsentThisWeek(lesson, currentDay);
        const hasSub = isAbsentNow && lesson.substitute;
        const isPrivate = lesson.isPrivate || (lesson.name && lesson.name.toLowerCase().includes('soukr'));
        const isEnsemble = lesson.ensemble || (lesson.name && lesson.name.toLowerCase().includes('kytarový soubor'));

        let stripeClass = '';
        let ensembleTitleClass = '';

        if (isPrivate) {
            stripeClass = 'private-card';
        } else if (isEnsemble) {
            const isEnsembleBlock = lesson.name && lesson.name.toLowerCase().includes('kytarový soubor');
            if (isEnsembleBlock) {
                if (lesson.ensembleGroup === 'younger') {
                    stripeClass = 'ensemble-purple';
                    ensembleTitleClass = 'ensemble-title-younger';
                } else {
                    stripeClass = 'ensemble-gold';
                    ensembleTitleClass = 'ensemble-title-older';
                }
            } else {
                const rocnikNum = parseInt(lesson.rocnik);
                if (!isNaN(rocnikNum) && rocnikNum >= 5) {
                    stripeClass = 'ensemble-gold';
                } else {
                    stripeClass = 'ensemble-purple';
                }
            }
        }

        let timeStatusClass = '';
        let progressPercent = 0;

        if (isToday) {
            if (currentMins >= endMins) {
                timeStatusClass = 'past-lesson';
            } else if (currentMins >= startMins && currentMins < endMins) {
                timeStatusClass = 'current-lesson';
                let elapsed = currentMins - startMins;
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
        card.className = `lesson-card ${swapSourceIndex === index ? 'swap-mode' : ''} ${isAbsentNow ? 'absent' : ''} ${hasSub ? 'has-substitute' : ''} ${stripeClass} ${timeStatusClass}`;

        if (timeStatusClass === 'current-lesson') {
            card.style.opacity = (1 - (progressPercent / 100) * 0.45).toFixed(2);
        }

        let detailsHtml = '';
        if (isPrivate) {
            detailsHtml = `<span style="color: #60a5fa; font-weight: 500;">Soukromá lekce</span>`;
            if (lesson.notes) {
                detailsHtml += `<div class="private-notes-preview">📝 ${lesson.notes}</div>`;
            }
        } else {
            let tags = [];
            if (lesson.rocnik) tags.push(`Roč: <span>${lesson.rocnik}</span>`);
            if (lesson.hn) tags.push(`HN: <span>${lesson.hn}</span>`);
            if (isEnsemble && !lesson.name.toLowerCase().includes('kytarový soubor')) {
                const badgeColor = stripeClass === 'ensemble-purple' ? '#c084fc' : '#ffd166';
                tags.push(`<span style="color: ${badgeColor}; font-weight: 600;">🎸 Soubor</span>`);
            }
            detailsHtml = tags.join(' | ');
        }

        const genderClass = getGenderClass(lesson.name);
        
        // Štítek omluvenky včetně data (pokud je zadáno)
        let absentBadge = '';
        if (isAbsentNow) {
            const dateNotice = lesson.absentDate ? ` (${lesson.absentDate})` : '';
            absentBadge = `<span class="badge-absent">Omluvenka${dateNotice}</span>`;
        }

        card.innerHTML = `
            <div class="time-col">
                <div>${lesson.time}</div>
                <div class="end-time">${endTime}</div>
            </div>
            <div class="info-col">
                <div class="student-name ${genderClass} ${ensembleTitleClass}">
                    ${lesson.name} ${absentBadge}
                </div>
                <div class="student-details">
                    ${detailsHtml}
                </div>
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

setInterval(() => {
    renderSchedule();
}, 60000);

// --- 7. Modální okno a správa hodin ---
function populateSubstituteSelect(currentLessonStudent) {
    const select = document.getElementById('substitute-select');
    if (!select) return;
    select.innerHTML = '<option value="">-- Vyberte stálého žáka --</option>';

    const allStudents = new Set();
    for (let day in schedule) {
        (schedule[day] || []).forEach(l => {
            if (l.name && l.name !== currentLessonStudent) {
                allStudents.add(l.name);
            }
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
    if (swapSourceIndex !== null) {
        if (swapSourceIndex === index) {
            swapSourceIndex = null;
        } else {
            const dayData = schedule[currentDay];
            const temp = { ...dayData[index] };
            dayData[index] = { ...dayData[swapSourceIndex], time: dayData[index].time };
            dayData[swapSourceIndex] = { ...temp, time: dayData[swapSourceIndex].time };

            swapSourceIndex = null;
            saveSchedule();
        }
        renderSchedule();
        return;
    }

    editingIndex = index;
    const lesson = schedule[currentDay][index];

    document.getElementById('edit-time').value = lesson.time;
    const nameInput = document.getElementById('edit-name');
    nameInput.value = lesson.name;
    document.getElementById('edit-rocnik').value = lesson.rocnik || '';
    document.getElementById('edit-hn').value = lesson.hn || '';
    document.getElementById('edit-notes').value = lesson.notes || '';

    const editPrivate = document.getElementById('edit-private');
    const isPriv = !!lesson.isPrivate || (lesson.name && lesson.name.toLowerCase().includes('soukr'));
    editPrivate.checked = isPriv;

    const stdFields = document.getElementById('standard-zus-fields');
    const privFields = document.getElementById('private-lesson-fields');
    const ensembleSelector = document.getElementById('ensemble-group-selector');
    const radYounger = document.getElementById('ensemble-younger');
    const radOlder = document.getElementById('ensemble-older');

    function updateModalView() {
        if (editPrivate.checked) {
            stdFields.style.display = 'none';
            privFields.style.display = 'block';
            if (ensembleSelector) ensembleSelector.style.display = 'none';
        } else {
            stdFields.style.display = 'block';
            privFields.style.display = 'none';
            const isEnsembleTitle = nameInput.value.toLowerCase().includes('kytarový soubor');
            if (ensembleSelector) {
                ensembleSelector.style.display = isEnsembleTitle ? 'block' : 'none';
            }
        }
    }

    editPrivate.onchange = updateModalView;
    nameInput.oninput = updateModalView;
    updateModalView();

    if (radYounger && radOlder) {
        if (lesson.ensembleGroup === 'younger') {
            radYounger.checked = true;
        } else {
            radOlder.checked = true;
        }
    }

    document.getElementById('edit-ensemble').checked = !!lesson.ensemble;

    // Omluvenky, datum omluvenky a záskok
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

    const toggleAbsentViews = () => {
        const isAbs = editAbsentCheckbox.checked;
        if (absentDateContainer) absentDateContainer.style.display = isAbs ? 'block' : 'none';
        if (subSection) subSection.style.display = isAbs ? 'block' : 'none';
    };

    editAbsentCheckbox.onchange = toggleAbsentViews;
    toggleAbsentViews();

    document.getElementById('btn-clear-sub').onclick = () => {
        subCustom.value = '';
        subSelect.value = '';
    };

    subSelect.onchange = () => {
        if (subSelect.value) {
            subCustom.value = subSelect.value;
        }
    };

    document.getElementById('edit-modal').classList.remove('hidden');
}

document.getElementById('btn-cancel').onclick = () => document.getElementById('edit-modal').classList.add('hidden');

document.getElementById('btn-save').onclick = () => {
    if (editingIndex !== null) {
        const dayData = schedule[currentDay];
        const isPriv = document.getElementById('edit-private').checked;
        const newTime = document.getElementById('edit-time').value;
        const newName = document.getElementById('edit-name').value.trim();

        dayData[editingIndex].time = newTime;
        dayData[editingIndex].name = newName;
        dayData[editingIndex].isPrivate = isPriv;

        let privateNotePayload = null;

        if (isPriv) {
            const enteredNotes = document.getElementById('edit-notes').value.trim();
            dayData[editingIndex].rocnik = '';
            dayData[editingIndex].hn = '';
            dayData[editingIndex].ensemble = false;
            dayData[editingIndex].notes = enteredNotes;

            if (enteredNotes) {
                privateNotePayload = {
                    day: currentDay,
                    time: newTime,
                    name: newName,
                    notes: enteredNotes
                };
            }
        } else {
            dayData[editingIndex].rocnik = document.getElementById('edit-rocnik').value.trim();
            dayData[editingIndex].hn = document.getElementById('edit-hn').value.trim();
            dayData[editingIndex].ensemble = document.getElementById('edit-ensemble').checked;
            dayData[editingIndex].notes = '';

            const radYounger = document.getElementById('ensemble-younger');
            if (radYounger && radYounger.checked) {
                dayData[editingIndex].ensembleGroup = 'younger';
            } else {
                dayData[editingIndex].ensembleGroup = 'older';
            }
        }

        // Uložení stavu a data omluvenky
        const isAbsent = document.getElementById('edit-absent').checked;
        dayData[editingIndex].absent = isAbsent;
        dayData[editingIndex].absentDate = isAbsent ? document.getElementById('edit-absent-date').value.trim() : '';

        const subVal = document.getElementById('substitute-custom').value.trim();
        dayData[editingIndex].substitute = (isAbsent && subVal) ? subVal : '';

        saveSchedule(privateNotePayload);
        renderSchedule();
    }
    document.getElementById('edit-modal').classList.add('hidden');
};

document.getElementById('btn-delete').onclick = () => {
    if (confirm('Opravdu chcete tuto hodinu smazat?')) {
        schedule[currentDay].splice(editingIndex, 1);
        saveSchedule();
        renderSchedule();
        document.getElementById('edit-modal').classList.add('hidden');
    }
};

document.getElementById('btn-swap').onclick = () => {
    swapSourceIndex = editingIndex;
    document.getElementById('edit-modal').classList.add('hidden');
    renderSchedule();
};

document.getElementById('add-lesson-btn').onclick = () => {
    const dayData = schedule[currentDay] || [];
    let newTime = "13:00";
    if (dayData.length > 0) {
        newTime = addMinutes(dayData[dayData.length - 1].time, 45);
    }
    let timeInput = prompt("Čas začátku nové hodiny (HH:MM):", newTime);
    if (!timeInput) return;
    let nameInput = prompt("Jméno žáka / Název hodiny:");
    if (nameInput === null) return;

    dayData.push({ time: timeInput, name: nameInput || "Nový žák", rocnik: "", hn: "", ensemble: false, notes: "", absent: false, absentDate: "" });
    saveSchedule();
    renderSchedule();
};

document.getElementById('add-break-btn').onclick = () => {
    let targetTime = prompt("Od jakého času chcete všechny následující hodiny posunout (HH:MM)?", "15:15");
    if (!targetTime) return;
    let duration = prompt("Kolik minut má pauza trvat?", "5");
    if (!duration) return;
    let mins = parseInt(duration);
    if (isNaN(mins)) return;

    schedule[currentDay].forEach(lesson => {
        if (lesson.time >= targetTime) {
            lesson.time = addMinutes(lesson.time, mins);
        }
    });
    saveSchedule();
    renderSchedule();
};

// --- 8. Gesta tažením (Swipe) ---
let touchStartX = 0;
let touchEndX = 0;

document.addEventListener('touchstart', e => {
    if (!document.getElementById('edit-modal').classList.contains('hidden')) return;
    touchStartX = e.changedTouches[0].screenX;
}, {passive: true});

document.addEventListener('touchend', e => {
    if (!document.getElementById('edit-modal').classList.contains('hidden')) return;
    touchEndX = e.changedTouches[0].screenX;

    let currentIndex = workDays.indexOf(currentDay);
    if (currentIndex === -1) return;

    if (touchEndX < touchStartX - 60) {
        if (currentIndex < workDays.length - 1) {
            currentDay = workDays[currentIndex + 1];
            swapSourceIndex = null;
            renderTabs();
            renderSchedule('right');
        }
    }
    if (touchEndX > touchStartX + 60) {
        if (currentIndex > 0) {
            currentDay = workDays[currentIndex - 1];
            swapSourceIndex = null;
            renderTabs();
            renderSchedule('left');
        }
    }
}, {passive: true});

// --- Start: Vykreslení z paměti a stažení z tabulky ---
renderTabs();
renderSchedule();
fetchCloudSchedule(true);