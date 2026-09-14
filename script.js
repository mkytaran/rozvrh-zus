const GOOGLE_APP_URL = "https://script.google.com/macros/s/AKfycbzbn-loEtgL8Q96wbLrqR9Jluff6YSdmnVxnjnmULq0OMTAsFgjAaEjn77hw66aqjel/exec";

// --- 1. Autentizace ---
let appPin = localStorage.getItem('zus_pin');
if (!appPin || appPin === "null" || appPin === "") {
    appPin = prompt("Zadejte tajný PIN pro přístup k rozvrhu:");
    if (appPin) localStorage.setItem('zus_pin', appPin.trim());
}

// --- 2. Datový model ---
const defaultMaster = {
    "Pondělí": [], "Úterý": [], "Středa": [], "Čtvrtek": [], "Pátek": []
};

let masterSchedule = defaultMaster;
let weekOverrides = {};
let studentNotesHistory = {};

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

    const rawHistory = localStorage.getItem('zus_notes_history');
    if (rawHistory) {
        try {
            studentNotesHistory = JSON.parse(rawHistory) || {};
        } catch (e) {
            studentNotesHistory = {};
        }
    }
})();

// --- 3. Stav aplikace ---
let weekOffset = 0;
const workDays = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'];
const dayMap = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];

const systemNow = new Date();
let currentDay = (systemNow.getDay() >= 1 && systemNow.getDay() <= 5) ? dayMap[systemNow.getDay()] : 'Pondělí';

let swapSourceIndex = null;
let editingIndex = null;
let editingEventId = null;
let editingEventOldIso = null;
let currentModalMode = 'lesson';
let playedChordForTime = null;

// --- 4. Kalendářní utility ---
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

function formatDateToInput(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function formatDateHuman(d) {
    return `${d.getDate()}. ${d.getMonth() + 1}.`;
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
    if (clean.includes('soubor') || clean.includes('soukr') || clean.includes('hodina') || clean.includes('koncert') || clean.includes('porada')) {
        return '';
    }
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

// --- 5. Web Audio API ---
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
    } catch (e) {}
}

// --- 6. Sloučení dat pro daný den ---
function getEffectiveDayLessons(dayName) {
    const rawLessons = masterSchedule[dayName] || [];
    const activeMonday = getMonday(new Date(), weekOffset);
    const isoKey = getISOWeekKey(activeMonday);
    const overrides = weekOverrides[isoKey] || {};
    const targetDayDate = getDateForDay(dayName, weekOffset);

    let lessons = rawLessons.map(lesson => {
        const key = `${dayName}_${lesson.time}`;
        const override = overrides[key] || {};

        const isAbsentInWeek = (override.absent !== undefined) ? override.absent : false;
        const absentDateVal = (override.absentDate !== undefined) ? override.absentDate : '';
        const substituteVal = (override.substitute !== undefined) ? override.substitute : '';

        const merged = {
            ...lesson,
            name: override.name !== undefined ? override.name : lesson.name,
            rocnik: override.rocnik !== undefined ? override.rocnik : lesson.rocnik,
            hn: override.hn !== undefined ? override.hn : lesson.hn,
            absent: isAbsentInWeek,
            absentDate: absentDateVal,
            substitute: substituteVal,
            isPrivate: override.isPrivate !== undefined ? override.isPrivate : lesson.isPrivate,
            notes: override.notes !== undefined ? override.notes : (lesson.notes || ''),
            ensemble: override.ensemble !== undefined ? override.ensemble : lesson.ensemble,
            ensembleGroup: override.ensembleGroup !== undefined ? override.ensembleGroup : lesson.ensembleGroup
        };

        merged.isAbsentCalculated = isLessonAbsentInDate(merged, targetDayDate);
        return merged;
    });

    if (overrides.extraEvents && Array.isArray(overrides.extraEvents)) {
        const eventsForThisDay = overrides.extraEvents.filter(ev => ev.day === dayName);
        lessons = lessons.concat(eventsForThisDay);
    }

    return lessons.sort((a, b) => a.time.localeCompare(b.time));
}

// --- 7. Vykreslování záložek a signalizačních teček ---
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
        const dotsContainer = btn.querySelector('.day-dots-container');

        if (nameSpan) nameSpan.textContent = dayShortNames[dayName] || dayName.slice(0, 2);
        if (dateSpan) dateSpan.textContent = `${dayDate.getDate()}.${dayDate.getMonth() + 1}.`;

        if (dotsContainer) {
            dotsContainer.innerHTML = '';
            const dayLessons = getEffectiveDayLessons(dayName);
            let hasAbsent = false;
            let hasConcert = false;
            let hasMeeting = false;

            dayLessons.forEach(l => {
                if (l.isEvent) {
                    if (l.eventKind === 'concert') hasConcert = true;
                    if (l.eventKind === 'meeting') hasMeeting = true;
                } else if (l.isAbsentCalculated) {
                    hasAbsent = true;
                }
            });

            if (hasAbsent) {
                const d = document.createElement('span');
                d.className = 'day-dot dot-absent';
                d.title = 'Omluvenka';
                dotsContainer.appendChild(d);
            }
            if (hasConcert) {
                const d = document.createElement('span');
                d.className = 'day-dot dot-concert';
                d.title = 'Koncert';
                dotsContainer.appendChild(d);
            }
            if (hasMeeting) {
                const d = document.createElement('span');
                d.className = 'day-dot dot-meeting';
                d.title = 'Porada / Školení';
                dotsContainer.appendChild(d);
            }
        }

        btn.onclick = () => {
            const oldIdx = workDays.indexOf(currentDay);
            const newIdx = workDays.indexOf(dayName);
            const dir = newIdx > oldIdx ? 'right' : (newIdx < oldIdx ? 'left' : '');
            currentDay = dayName;
            swapSourceIndex = null;
            document.body.classList.remove('is-card-flipped-active');
            renderTabs();
            renderSchedule(dir);
        };
    });
}

// --- 8. Vykreslování rozvrhu s ošetřením duplicit v časové ose ---
function toggleCardFlip(wrapperElement) {
    const isFlipped = wrapperElement.classList.contains('flipped');

    document.querySelectorAll('.lesson-card-wrapper.flipped').forEach(el => {
        if (el !== wrapperElement) {
            el.classList.remove('flipped', 'is-active-flipped');
        }
    });

    if (isFlipped) {
        wrapperElement.classList.remove('flipped', 'is-active-flipped');
        document.body.classList.remove('is-card-flipped-active');
    } else {
        wrapperElement.classList.add('flipped', 'is-active-flipped');
        document.body.classList.add('is-card-flipped-active');
    }
}

function renderSchedule(animDir = '') {
    const container = document.getElementById('schedule-container');
    container.classList.remove('slide-from-right', 'slide-from-left');
    void container.offsetWidth;
    if (animDir === 'right') container.classList.add('slide-from-right');
    if (animDir === 'left') container.classList.add('slide-from-left');

    container.innerHTML = '';
    document.body.classList.remove('is-card-flipped-active');

    const dayData = getEffectiveDayLessons(currentDay);
    const now = new Date();
    const isCurrentRealWeek = (weekOffset === 0);
    const isToday = isCurrentRealWeek && (dayMap[now.getDay()] === currentDay);
    const currentMins = now.getHours() * 60 + now.getMinutes();

    let previousStudentEndMins = null;

    dayData.forEach((lesson, index) => {
        const isEvent = !!lesson.isEvent;
        const startMins = timeToMinutes(lesson.time);
        
        let endTime = lesson.endTime;
        if (!endTime) {
            endTime = addMinutes(lesson.time, isEvent ? 60 : 45);
        }
        const endMins = timeToMinutes(endTime);

        if (!isEvent) {
            if (previousStudentEndMins !== null && startMins > previousStudentEndMins) {
                const diffMins = startMins - previousStudentEndMins;
                if (diffMins > 0) {
                    const breakEl = document.createElement('div');
                    breakEl.className = 'break-indicator';
                    breakEl.textContent = `— pauza ${diffMins} min —`;
                    container.appendChild(breakEl);
                }
            }
            previousStudentEndMins = endMins;
        }

        const studentHistory = (!isEvent && lesson.name && studentNotesHistory[lesson.name]) ? studentNotesHistory[lesson.name] : [];
        const hasCurrentNotes = !!(lesson.notes && lesson.notes.trim().length > 0);
        const hasAnyNotes = hasCurrentNotes || (studentHistory.length > 0);

        const isAbsent = !isEvent && !!lesson.isAbsentCalculated;
        const hasSub = isAbsent && lesson.substitute;
        const isPrivate = !isEvent && (lesson.isPrivate || (lesson.name && lesson.name.toLowerCase().includes('soukr')));
        const isEnsemble = !isEvent && (lesson.ensemble || (lesson.name && lesson.name.toLowerCase().includes('kytarový soubor')));

        let stripeClass = '';
        let titleColorClass = '';
        let wrapperExtraClass = '';

        if (isEvent) {
            const isConcert = lesson.eventKind === 'concert';
            stripeClass = isConcert ? 'event-concert' : 'event-meeting';
            titleColorClass = isConcert ? 'event-title-concert' : 'event-title-meeting';
            wrapperExtraClass = isConcert ? 'event-concert-wrapper' : 'event-meeting-wrapper';
        } else if (isPrivate) {
            stripeClass = 'private-card';
        } else if (isEnsemble) {
            const isBlock = lesson.name && lesson.name.toLowerCase().includes('kytarový soubor');
            if (isBlock) {
                if (lesson.ensembleGroup === 'younger') {
                    stripeClass = 'ensemble-purple';
                    titleColorClass = 'ensemble-title-younger';
                } else {
                    stripeClass = 'ensemble-gold';
                    titleColorClass = 'ensemble-title-older';
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
                const totalDuration = endMins - startMins;
                const elapsed = currentMins - startMins;
                progressPercent = Math.min(100, Math.round((elapsed / totalDuration) * 100));

                if (!isEvent && (totalDuration - elapsed === 5) && playedChordForTime !== `${currentDay}-${lesson.time}`) {
                    playedChordForTime = `${currentDay}-${lesson.time}`;
                    playGuitarChord();
                }
            }
        }

        let detailsHtml = '';
        if (isEvent) {
            const chipClass = lesson.eventKind === 'concert' ? 'concert' : 'meeting';
            const chipText = lesson.eventKind === 'concert' ? '🎻 Koncert / Akce' : '📋 Porada / Školení';
            detailsHtml = `<span class="event-chip ${chipClass}">${chipText}</span>`;
        } else if (isPrivate) {
            detailsHtml = `<span style="color: #2563eb; font-weight: 500;">Soukromá lekce</span>`;
        } else {
            let tags = [];
            if (lesson.rocnik) tags.push(`Roč: <span>${lesson.rocnik}</span>`);
            if (lesson.hn) tags.push(`HN: <span>${lesson.hn}</span>`);
            if (isEnsemble && !lesson.name.toLowerCase().includes('kytarový soubor')) {
                const color = stripeClass === 'ensemble-purple' ? '#9333ea' : '#d97706';
                tags.push(`<span style="color: ${color}; font-weight: 600;">🎸 Soubor</span>`);
            }
            detailsHtml = tags.join(' | ');
        }

        const absentBadge = isAbsent ? `<span class="badge-absent">Omluvenka${lesson.absentDate ? ` (${lesson.absentDate})` : ''}</span>` : '';
        const noteFlagClass = hasAnyNotes ? 'has-note' : '';
        const wrapper = document.createElement('div');
        wrapper.className = `lesson-card-wrapper ${wrapperExtraClass} ${noteFlagClass}`;

        const flipInner = document.createElement('div');
        flipInner.className = 'flip-card-inner';

        // LÍCOVÁ STRANA KARTY
        const cardFront = document.createElement('div');
        cardFront.className = `flip-card-front lesson-card ${swapSourceIndex === index ? 'swap-mode' : ''} ${isAbsent ? 'absent' : ''} ${hasSub ? 'has-substitute' : ''} ${stripeClass} ${timeStatusClass}`;

        if (timeStatusClass === 'current-lesson') {
            cardFront.style.opacity = (1 - (progressPercent / 100) * 0.45).toFixed(2);
        }

        cardFront.innerHTML = `
            <div class="time-col">
                <div>${lesson.time}</div>
                <div class="end-time">${endTime}</div>
            </div>
            <div class="info-col">
                <div class="student-name ${getGenderClass(lesson.name)} ${titleColorClass}">
                    ${lesson.name} ${absentBadge}
                </div>
                <div class="student-details">${detailsHtml}</div>
            </div>
            ${timeStatusClass === 'current-lesson' ? `<div class="lesson-progress-bar" style="width: ${progressPercent}%;"></div>` : ''}
        `;

        cardFront.onclick = () => {
            if (swapSourceIndex !== null) {
                handleCardClick(index);
                return;
            }
            if (hasAnyNotes) {
                toggleCardFlip(wrapper);
            } else {
                handleCardClick(index);
            }
        };

        flipInner.appendChild(cardFront);

        // RUBOVÁ STRANA KARTY (Deduplikovaná časová osa)
        if (hasAnyNotes) {
            const cardBack = document.createElement('div');
            cardBack.className = 'flip-card-back';

            let historyChipsHtml = '';
            let initialText = '';

            if (!isEvent) {
                const currentDayHuman = formatDateHuman(getDateForDay(currentDay, weekOffset));
                const timelineEntries = [];

                // 1. Záznam pro aktuální otevřenou lekci
                if (hasCurrentNotes) {
                    timelineEntries.push({
                        date: currentDayHuman,
                        notes: lesson.notes
                    });
                }

                // 2. Historické záznamy (vynecháme duplikát dnešního dne)
                studentHistory.forEach(h => {
                    if (h.date !== currentDayHuman && h.notes) {
                        timelineEntries.push(h);
                    }
                });

                if (timelineEntries.length > 0) {
                    initialText = timelineEntries[0].notes;
                }

                if (timelineEntries.length > 1) {
                    const chips = timelineEntries.map((entry, idx) => {
                        return `<button type="button" class="history-chip ${idx === 0 ? 'active' : ''}" data-content="${encodeURIComponent(entry.notes)}">${entry.date}</button>`;
                    });
                    historyChipsHtml = `<div class="note-history-chips">${chips.join('')}</div>`;
                }
            } else {
                initialText = lesson.notes || '';
            }

            cardBack.innerHTML = `
                <div>
                    <div class="flip-back-header">
                        <span class="flip-back-title">${isEvent ? (lesson.eventKind === 'concert' ? '🎻 Koncert' : '📋 Porada') : '📝 Zápisník žáka'}: ${lesson.name}</span>
                        <div class="flip-back-actions">
                            <button type="button" class="btn-card-edit-mini" title="Upravit">✏️</button>
                        </div>
                    </div>
                    ${historyChipsHtml}
                    <div class="flip-back-body">${initialText}</div>
                </div>
                <div class="flip-back-footer">Klepnutím otočit zpět ↩</div>
            `;

            cardBack.querySelectorAll('.history-chip').forEach(chipBtn => {
                chipBtn.onclick = (e) => {
                    e.stopPropagation();
                    cardBack.querySelectorAll('.history-chip').forEach(c => c.classList.remove('active'));
                    chipBtn.classList.add('active');
                    const bodyEl = cardBack.querySelector('.flip-back-body');
                    if (bodyEl) {
                        bodyEl.textContent = decodeURIComponent(chipBtn.dataset.content);
                    }
                };
            });

            cardBack.onclick = (e) => {
                if (e.target.closest('.btn-card-edit-mini')) {
                    e.stopPropagation();
                    wrapper.classList.remove('flipped', 'is-active-flipped');
                    document.body.classList.remove('is-card-flipped-active');
                    handleCardClick(index);
                    return;
                }
                toggleCardFlip(wrapper);
            };

            flipInner.appendChild(cardBack);
        }

        wrapper.appendChild(flipInner);

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

document.addEventListener('click', (e) => {
    if (document.body.classList.contains('is-card-flipped-active')) {
        if (!e.target.closest('.lesson-card-wrapper.flipped')) {
            document.querySelectorAll('.lesson-card-wrapper.flipped').forEach(w => {
                w.classList.remove('flipped', 'is-active-flipped');
            });
            document.body.classList.remove('is-card-flipped-active');
        }
    }
});

// --- 9. Ukládání a synchronizace ---
function saveSchedule(newPrivateNote = null) {
    localStorage.setItem('zus_master_schedule', JSON.stringify(masterSchedule));
    localStorage.setItem('zus_week_overrides', JSON.stringify(weekOverrides));
    localStorage.setItem('zus_notes_history', JSON.stringify(studentNotesHistory));

    const payload = {
        master: masterSchedule,
        overrides: weekOverrides,
        newPrivateNote: newPrivateNote
    };

    fetch(GOOGLE_APP_URL + "?pin=" + encodeURIComponent(appPin), {
        method: 'POST',
        body: JSON.stringify(payload)
    }).then(() => console.log("Synchronizováno se sešitem"))
      .catch(err => console.error("Chyba synchronizace", err));
}

function fetchCloudSchedule(silent = true) {
    if (!appPin) return;

    fetch(GOOGLE_APP_URL + "?pin=" + encodeURIComponent(appPin))
        .then(res => res.text())
        .then(text => {
            if (text.includes("Přístup odepřen")) {
                if (!silent) alert("Špatný PIN.");
                return;
            }
            const data = JSON.parse(text);
            if (data.master || data["Pondělí"]) {
                masterSchedule = data.master || data;
                if (data.overrides) weekOverrides = data.overrides;
                if (data.notesHistory) studentNotesHistory = data.notesHistory;

                localStorage.setItem('zus_master_schedule', JSON.stringify(masterSchedule));
                localStorage.setItem('zus_week_overrides', JSON.stringify(weekOverrides));
                localStorage.setItem('zus_notes_history', JSON.stringify(studentNotesHistory));

                renderTabs();
                renderSchedule();
                if (!silent) alert("Rozvrh byl úspěšně synchronizován.");
            }
        })
        .catch(() => {
            if (!silent) alert("Pracujete v offline režimu.");
        });
}

// --- 10. Modál úprav ---
function setModalMode(mode) {
    currentModalMode = mode;
    const btnLesson = document.getElementById('type-btn-lesson');
    const btnEvent = document.getElementById('type-btn-event');
    const zusFields = document.getElementById('standard-zus-fields');
    const eventFields = document.getElementById('event-specific-fields');
    const rowPrivate = document.getElementById('row-private-toggle');
    const rowAbsent = document.getElementById('row-absent-section');
    const groupEnd = document.getElementById('group-end-time');
    const labelName = document.getElementById('label-edit-name');
    const labelNotes = document.getElementById('label-edit-notes');
    const groupDaySelect = document.getElementById('group-day-select');
    const groupEventDate = document.getElementById('group-event-date');

    if (mode === 'event') {
        btnEvent.classList.add('active');
        btnLesson.classList.remove('active');
        zusFields.style.display = 'none';
        rowPrivate.style.display = 'none';
        if (rowAbsent) rowAbsent.style.display = 'none';
        eventFields.style.display = 'block';
        groupEnd.style.display = 'block';
        labelName.textContent = 'Název akce / Porady:';
        labelNotes.textContent = 'Podrobnosti / Místo / Program:';

        if (groupDaySelect) groupDaySelect.style.display = 'none';
        if (groupEventDate) groupEventDate.style.display = 'block';
    } else {
        btnLesson.classList.add('active');
        btnEvent.classList.remove('active');
        zusFields.style.display = 'block';
        rowPrivate.style.display = 'flex';
        if (rowAbsent) rowAbsent.style.display = 'block';
        eventFields.style.display = 'none';
        groupEnd.style.display = 'none';
        labelName.textContent = 'Jméno žáka / Název hodiny:';
        labelNotes.textContent = 'Zápisník a poznámky k výuce:';

        if (groupDaySelect) groupDaySelect.style.display = 'block';
        if (groupEventDate) groupEventDate.style.display = 'none';
    }
}

document.getElementById('type-btn-lesson').onclick = () => setModalMode('lesson');
document.getElementById('type-btn-event').onclick = () => setModalMode('event');

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

    if (swapSourceIndex !== null) {
        if (swapSourceIndex !== index) {
            const activeMonday = getMonday(new Date(), weekOffset);
            const isoKey = getISOWeekKey(activeMonday);
            if (!weekOverrides[isoKey]) weekOverrides[isoKey] = {};

            const lessonA = effectiveLessons[swapSourceIndex];
            const lessonB = effectiveLessons[index];

            if (!lessonA.isEvent && !lessonB.isEvent) {
                weekOverrides[isoKey][`${currentDay}_${lessonA.time}`] = {
                    name: lessonB.name, rocnik: lessonB.rocnik, hn: lessonB.hn, ensemble: lessonB.ensemble
                };
                weekOverrides[isoKey][`${currentDay}_${lessonB.time}`] = {
                    name: lessonA.name, rocnik: lessonA.rocnik, hn: lessonA.hn, ensemble: lessonA.ensemble
                };
                saveSchedule();
            }
        }
        swapSourceIndex = null;
        renderTabs();
        renderSchedule();
        return;
    }

    const lesson = effectiveLessons[index];
    const daySelect = document.getElementById('edit-day');
    if (daySelect) daySelect.value = currentDay;

    const eventDateInput = document.getElementById('edit-event-date');
    if (eventDateInput) {
        const currentSelectedDate = getDateForDay(currentDay, weekOffset);
        eventDateInput.value = formatDateToInput(currentSelectedDate);
    }

    if (lesson.isEvent) {
        editingIndex = null;
        editingEventId = lesson.id;
        const activeMonday = getMonday(new Date(), weekOffset);
        editingEventOldIso = getISOWeekKey(activeMonday);

        setModalMode('event');
        document.getElementById('edit-time').value = lesson.time;
        document.getElementById('edit-event-end').value = lesson.endTime || '';
        document.getElementById('edit-name').value = lesson.name;
        document.getElementById('edit-notes').value = lesson.notes || '';
        if (lesson.eventKind === 'meeting') {
            document.getElementById('event-meeting').checked = true;
        } else {
            document.getElementById('event-concert').checked = true;
        }
        document.getElementById('btn-swap').style.display = 'none';
    } else {
        editingIndex = index;
        editingEventId = null;
        editingEventOldIso = null;
        setModalMode('lesson');
        document.getElementById('btn-swap').style.display = 'block';

        document.getElementById('edit-time').value = lesson.time;
        const nameInput = document.getElementById('edit-name');
        nameInput.value = lesson.name;
        document.getElementById('edit-rocnik').value = lesson.rocnik || '';
        document.getElementById('edit-hn').value = lesson.hn || '';
        document.getElementById('edit-notes').value = lesson.notes || '';

        const editPrivate = document.getElementById('edit-private');
        editPrivate.checked = !!lesson.isPrivate || (lesson.name && lesson.name.toLowerCase().includes('soukr'));

        const ensembleSelector = document.getElementById('ensemble-group-selector');
        const radYounger = document.getElementById('ensemble-younger');
        const radOlder = document.getElementById('ensemble-older');

        function updateModalFields() {
            if (editPrivate.checked) {
                document.getElementById('standard-zus-fields').style.display = 'none';
                if (ensembleSelector) ensembleSelector.style.display = 'none';
            } else {
                document.getElementById('standard-zus-fields').style.display = 'block';
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

        const activeMonday = getMonday(new Date(), weekOffset);
        const isoKey = getISOWeekKey(activeMonday);
        const currentOverride = (weekOverrides[isoKey] && weekOverrides[isoKey][`${currentDay}_${lesson.time}`]) || {};

        const editAbsentCheckbox = document.getElementById('edit-absent');
        const absentDateContainer = document.getElementById('absent-date-container');
        const editAbsentDateInput = document.getElementById('edit-absent-date');
        const subSection = document.getElementById('substitute-section');
        const subCustom = document.getElementById('substitute-custom');
        const subSelect = document.getElementById('substitute-select');

        populateSubstituteSelect(lesson.name);

        const isCurrentlyAbsent = !!lesson.isAbsentCalculated;
        editAbsentCheckbox.checked = isCurrentlyAbsent;
        editAbsentDateInput.value = currentOverride.absentDate || lesson.absentDate || '';
        subCustom.value = currentOverride.substitute || lesson.substitute || '';
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
        subSelect.onchange = () => { 
            if (subSelect.value) subCustom.value = subSelect.value; 
        };
    }

    document.getElementById('edit-modal').classList.remove('hidden');
}

document.getElementById('btn-cancel').onclick = () => document.getElementById('edit-modal').classList.add('hidden');

document.getElementById('btn-save').onclick = () => {
    // 1. Událost
    if (currentModalMode === 'event') {
        const timeVal = document.getElementById('edit-time').value;
        const endVal = document.getElementById('edit-event-end').value || addMinutes(timeVal, 60);
        const nameVal = document.getElementById('edit-name').value.trim() || 'Pracovní akce';
        const kindVal = document.getElementById('event-meeting').checked ? 'meeting' : 'concert';
        const notesVal = document.getElementById('edit-notes').value.trim();

        const chosenDateStr = document.getElementById('edit-event-date').value;
        let targetDate;
        if (chosenDateStr) {
            const [y, m, d] = chosenDateStr.split('-').map(Number);
            targetDate = new Date(y, m - 1, d);
        } else {
            targetDate = getDateForDay(currentDay, weekOffset);
        }

        const targetDayName = dayMap[targetDate.getDay()];
        const targetIsoKey = getISOWeekKey(targetDate);

        if (editingEventId && editingEventOldIso && editingEventOldIso !== targetIsoKey) {
            if (weekOverrides[editingEventOldIso] && weekOverrides[editingEventOldIso].extraEvents) {
                weekOverrides[editingEventOldIso].extraEvents = weekOverrides[editingEventOldIso].extraEvents.filter(e => e.id !== editingEventId);
            }
        }

        if (!weekOverrides[targetIsoKey]) weekOverrides[targetIsoKey] = {};
        if (!weekOverrides[targetIsoKey].extraEvents) weekOverrides[targetIsoKey].extraEvents = [];

        const finalEventId = editingEventId || ('ev_' + Date.now());
        const eventObject = {
            id: finalEventId,
            day: targetDayName,
            time: timeVal,
            endTime: endVal,
            name: nameVal,
            isEvent: true,
            eventKind: kindVal,
            notes: notesVal
        };

        const existingIdx = weekOverrides[targetIsoKey].extraEvents.findIndex(e => e.id === finalEventId);
        if (existingIdx !== -1) {
            weekOverrides[targetIsoKey].extraEvents[existingIdx] = eventObject;
        } else {
            weekOverrides[targetIsoKey].extraEvents.push(eventObject);
        }

        const now = new Date();
        const currMonday = getMonday(now, 0);
        const targetMonday = getMonday(targetDate, 0);
        weekOffset = Math.round((targetMonday - currMonday) / (7 * 24 * 60 * 60 * 1000));
        if (workDays.includes(targetDayName)) currentDay = targetDayName;

        updateWeekStepperUI();
        renderTabs();
        saveSchedule();
        renderSchedule();
        document.getElementById('edit-modal').classList.add('hidden');
        return;
    }

    // 2. Výuka žáka
    const activeMonday = getMonday(new Date(), weekOffset);
    const isoKey = getISOWeekKey(activeMonday);
    if (!weekOverrides[isoKey]) weekOverrides[isoKey] = {};

    const targetDay = document.getElementById('edit-day') ? document.getElementById('edit-day').value : currentDay;

    if (editingIndex !== null) {
        const isPriv = document.getElementById('edit-private').checked;
        const newTime = document.getElementById('edit-time').value;
        const newName = document.getElementById('edit-name').value.trim();
        const isAbs = document.getElementById('edit-absent').checked;
        const absDate = isAbs ? document.getElementById('edit-absent-date').value.trim() : '';
        const subVal = document.getElementById('substitute-custom').value.trim();
        const notesVal = document.getElementById('edit-notes').value.trim();

        const key = `${currentDay}_${newTime}`;
        weekOverrides[isoKey][key] = {
            absent: isAbs,
            absentDate: absDate,
            substitute: (isAbs && subVal) ? subVal : '',
            notes: notesVal
        };

        let noteHistoryPayload = null;
        if (notesVal) {
            const lessonDateHuman = formatDateHuman(getDateForDay(currentDay, weekOffset));
            noteHistoryPayload = {
                date: lessonDateHuman,
                student: newName,
                notes: notesVal
            };

            if (!studentNotesHistory[newName]) studentNotesHistory[newName] = [];
            studentNotesHistory[newName] = studentNotesHistory[newName].filter(h => h.date !== lessonDateHuman);
            studentNotesHistory[newName].unshift({ date: lessonDateHuman, notes: notesVal });
        }

        const masterLessons = masterSchedule[currentDay] || [];

        if (targetDay !== currentDay && masterLessons[editingIndex]) {
            const movedLesson = masterLessons.splice(editingIndex, 1)[0];
            movedLesson.time = newTime;
            movedLesson.name = newName;
            movedLesson.isPrivate = isPriv;
            movedLesson.notes = notesVal;
            movedLesson.absent = false;

            if (!masterSchedule[targetDay]) masterSchedule[targetDay] = [];
            masterSchedule[targetDay].push(movedLesson);

            currentDay = targetDay;
            renderTabs();
        } else if (masterLessons[editingIndex]) {
            masterLessons[editingIndex].time = newTime;
            masterLessons[editingIndex].name = newName;
            masterLessons[editingIndex].isPrivate = isPriv;
            masterLessons[editingIndex].notes = notesVal;
            masterLessons[editingIndex].absent = false;

            if (isPriv) {
                masterLessons[editingIndex].rocnik = '';
                masterLessons[editingIndex].hn = '';
                masterLessons[editingIndex].ensemble = false;
            } else {
                masterLessons[editingIndex].rocnik = document.getElementById('edit-rocnik').value.trim();
                masterLessons[editingIndex].hn = document.getElementById('edit-hn').value.trim();
                masterLessons[editingIndex].ensemble = document.getElementById('edit-ensemble').checked;

                const radYounger = document.getElementById('ensemble-younger');
                masterLessons[editingIndex].ensembleGroup = (radYounger && radYounger.checked) ? 'younger' : 'older';
            }
        }

        saveSchedule(noteHistoryPayload);
        renderTabs();
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
    if (editingEventId) {
        if (confirm('Opravdu chcete tuto událost smazat?')) {
            const activeMonday = getMonday(new Date(), weekOffset);
            const isoKey = editingEventOldIso || getISOWeekKey(activeMonday);
            if (weekOverrides[isoKey] && weekOverrides[isoKey].extraEvents) {
                weekOverrides[isoKey].extraEvents = weekOverrides[isoKey].extraEvents.filter(e => e.id !== editingEventId);
                saveSchedule();
                renderTabs();
                renderSchedule();
            }
            document.getElementById('edit-modal').classList.add('hidden');
        }
        return;
    }

    if (confirm('Opravdu chcete tuto hodinu smazat z kmenového rozvrhu?')) {
        (masterSchedule[currentDay] || []).splice(editingIndex, 1);
        saveSchedule();
        renderTabs();
        renderSchedule();
        document.getElementById('edit-modal').classList.add('hidden');
    }
};

// Spodní lišta: Přidat hodinu
document.getElementById('add-lesson-btn').onclick = () => {
    editingIndex = null;
    editingEventId = null;
    editingEventOldIso = null;
    setModalMode('lesson');
    document.getElementById('btn-swap').style.display = 'none';

    const daySelect = document.getElementById('edit-day');
    if (daySelect) daySelect.value = currentDay;

    const list = masterSchedule[currentDay] || [];
    let defaultTime = "13:00";
    if (list.length > 0) defaultTime = addMinutes(list[list.length - 1].time, 45);

    document.getElementById('edit-time').value = defaultTime;
    document.getElementById('edit-name').value = "";
    document.getElementById('edit-rocnik').value = "";
    document.getElementById('edit-hn').value = "";
    document.getElementById('edit-notes').value = "";
    document.getElementById('edit-private').checked = false;
    document.getElementById('edit-ensemble').checked = false;
    document.getElementById('edit-absent').checked = false;
    document.getElementById('edit-absent-date').value = "";
    document.getElementById('substitute-custom').value = "";

    document.getElementById('edit-modal').classList.remove('hidden');
};

// Spodní lišta: Přidat událost
document.getElementById('add-event-btn').onclick = () => {
    editingIndex = null;
    editingEventId = null;
    editingEventOldIso = null;
    setModalMode('event');
    document.getElementById('btn-swap').style.display = 'none';

    const currentSelectedDate = getDateForDay(currentDay, weekOffset);
    const eventDateInput = document.getElementById('edit-event-date');
    if (eventDateInput) eventDateInput.value = formatDateToInput(currentSelectedDate);

    document.getElementById('edit-time').value = "18:00";
    document.getElementById('edit-event-end').value = "19:30";
    document.getElementById('edit-name').value = "";
    document.getElementById('edit-notes').value = "";
    document.getElementById('event-concert').checked = true;

    document.getElementById('edit-modal').classList.remove('hidden');
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
    renderTabs();
    renderSchedule();
};

// --- 11. Navigace ---
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

const datePicker = document.getElementById('native-date-picker');
const weekTrigger = document.getElementById('week-trigger');

if (weekTrigger && datePicker) {
    weekTrigger.onclick = () => {
        if (datePicker.showPicker) datePicker.showPicker();
        else datePicker.click();
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

// Swipe gesta
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

setInterval(() => {
    if (weekOffset === 0) renderSchedule();
}, 60000);

// --- 12. Správa motivu a systémové lišty ---
function initTheme() {
    const btnTheme = document.getElementById('btn-theme');
    const sunIcon = document.getElementById('icon-theme-sun');
    const moonIcon = document.getElementById('icon-theme-moon');

    function updateSystemStatusBar(theme) {
        const isDark = (theme === 'dark');
        const targetColor = isDark ? '#1a1e26' : '#faf8f5';

        let meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
            document.head.appendChild(meta);
        }
        meta.setAttribute('content', targetColor);

        let appleMeta = document.getElementById('apple-status-bar-meta');
        if (appleMeta) {
            appleMeta.setAttribute('content', isDark ? 'black-translucent' : 'default');
        }
    }

    function applyTheme(theme) {
        const root = document.documentElement;
        if (theme === 'dark') {
            root.classList.remove('theme-light');
            root.classList.add('theme-dark');
            if (sunIcon) sunIcon.style.display = 'block';
            if (moonIcon) moonIcon.style.display = 'none';
        } else {
            root.classList.remove('theme-dark');
            root.classList.add('theme-light');
            if (sunIcon) sunIcon.style.display = 'none';
            if (moonIcon) moonIcon.style.display = 'block';
        }

        updateSystemStatusBar(theme);
        localStorage.setItem('zus_theme', theme);
    }

    let currentTheme = localStorage.getItem('zus_theme');
    if (!currentTheme) {
        const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        currentTheme = systemPrefersDark ? 'dark' : 'light';
    }
    applyTheme(currentTheme);

    if (btnTheme) {
        btnTheme.onclick = (e) => {
            e.preventDefault();
            if (navigator.vibrate) navigator.vibrate(30);
            const isDark = document.documentElement.classList.contains('theme-dark');
            applyTheme(isDark ? 'light' : 'dark');
        };
    }
}

// Start
initTheme();
updateWeekStepperUI();
renderTabs();
renderSchedule();
fetchCloudSchedule(true);