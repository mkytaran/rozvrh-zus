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

let swapSourceStudent = null;
let editingStudentName = null;
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

function parseInputDate(str) {
    if (!str) return null;
    const parts = str.split('-').map(Number);
    if (parts.length !== 3) return null;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    d.setHours(0, 0, 0, 0);
    return d;
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
    if (dateStr.includes('-') || dateStr.includes('–')) {
        const separator = dateStr.includes('–') ? '–' : '-';
        const [startPart, endPart] = dateStr.split(separator);
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
    const activeMonday = getMonday(new Date(), weekOffset);
    const isoKey = getISOWeekKey(activeMonday);
    const overrides = weekOverrides[isoKey] || {};
    const targetDayDate = getDateForDay(dayName, weekOffset);

    const allSlots = [];

    workDays.forEach(d => {
        (masterSchedule[d] || []).forEach((lesson, idx) => {
            if (!lesson.name || !lesson.name.trim()) return;

            const nameKey = lesson.name.trim();
            const slotKey = `${d}_slot_${idx}`;
            const timeKey = `${d}_${lesson.time}`;

            const override = overrides[nameKey] || overrides[slotKey] || overrides[timeKey] || {};

            const effectiveDay = override.effectiveDay !== undefined ? override.effectiveDay : d;
            const effectiveTime = override.time !== undefined ? override.time : lesson.time;

            const isAbsentInWeek = (override.absent !== undefined) ? override.absent : false;
            const absentDateVal = (override.absentDate !== undefined) ? override.absentDate : '';
            const substituteVal = (override.substitute !== undefined) ? override.substitute : '';

            allSlots.push({
                ...lesson,
                originalDay: d,
                day: effectiveDay,
                name: nameKey,
                time: effectiveTime,
                rocnik: override.rocnik !== undefined ? override.rocnik : lesson.rocnik,
                hn: override.hn !== undefined ? override.hn : lesson.hn,
                absent: isAbsentInWeek,
                absentDate: absentDateVal,
                substitute: substituteVal,
                isPrivate: override.isPrivate !== undefined ? override.isPrivate : lesson.isPrivate,
                notes: override.notes !== undefined ? override.notes : '',
                ensemble: override.ensemble !== undefined ? override.ensemble : lesson.ensemble,
                ensembleGroup: override.ensembleGroup !== undefined ? override.ensembleGroup : lesson.ensembleGroup,
                swapPendingWith: override.swapPendingWith || null
            });
        });
    });

    let lessons = allSlots.filter(l => l.day === dayName).map(l => {
        l.isAbsentCalculated = isLessonAbsentInDate(l, targetDayDate);
        return l;
    });

    if (overrides.extraEvents && Array.isArray(overrides.extraEvents)) {
        const eventsForThisDay = overrides.extraEvents.filter(ev => ev.day === dayName);
        lessons = lessons.concat(eventsForThisDay);
    }

    return lessons.sort((a, b) => a.time.localeCompare(b.time));
}

// --- 7. Záložky dnů a tečky ---
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
                dotsContainer.appendChild(d);
            }
            if (hasConcert) {
                const d = document.createElement('span');
                d.className = 'day-dot dot-concert';
                dotsContainer.appendChild(d);
            }
            if (hasMeeting) {
                const d = document.createElement('span');
                d.className = 'day-dot dot-meeting';
                dotsContainer.appendChild(d);
            }
        }

        btn.onclick = () => {
            const oldIdx = workDays.indexOf(currentDay);
            const newIdx = workDays.indexOf(dayName);
            const dir = newIdx > oldIdx ? 'right' : (newIdx < oldIdx ? 'left' : '');
            currentDay = dayName;
            document.body.classList.remove('is-card-flipped-active');
            renderTabs();
            renderSchedule(dir);
        };
    });
}

// --- 8. Vykreslení karet rozvrhu ---
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

        const hasCurrentWeekNote = !!(lesson.notes && lesson.notes.trim().length > 0);
        const studentHistory = (!isEvent && lesson.name && studentNotesHistory[lesson.name]) ? studentNotesHistory[lesson.name] : [];

        const isAbsent = !isEvent && !!lesson.isAbsentCalculated;
        const hasSub = isAbsent && lesson.substitute;
        const isPrivate = !isEvent && (lesson.isPrivate || (lesson.name && lesson.name.toLowerCase().includes('soukr')));
        const isEnsemble = !isEvent && (lesson.ensemble || (lesson.name && lesson.name.toLowerCase().includes('kytarový soubor')));
        const isSwapPending = !isEvent && !!lesson.swapPendingWith;

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
            detailsHtml = `<span style="color: var(--stripe-private); font-weight: 600;">Soukromá lekce</span>`;
        } else {
            let tags = [];
            if (lesson.rocnik) tags.push(`Roč: <span>${lesson.rocnik}</span>`);
            if (lesson.hn) tags.push(`HN: <span>${lesson.hn}</span>`);
            if (isEnsemble && !lesson.name.toLowerCase().includes('kytarový soubor')) {
                const color = stripeClass === 'ensemble-purple' ? 'var(--stripe-purple)' : 'var(--stripe-gold)';
                tags.push(`<span style="color: ${color}; font-weight: 700;">🎸 Soubor</span>`);
            }
            detailsHtml = tags.join(' | ');
        }

        if (isSwapPending) {
            const p = lesson.swapPendingWith;
            detailsHtml += `<br><span class="swap-badge">⇄ Plánovaná výměna za: <strong>${p.name}</strong> (${p.targetDay} v ${p.targetTime})</span>`;
        }

        const absentBadge = isAbsent ? `<span class="badge-absent">Omluvenka${lesson.absentDate ? ` (${lesson.absentDate})` : ''}</span>` : '';
        const noteFlagClass = hasCurrentWeekNote ? 'has-note' : '';
        const isSwapSource = swapSourceStudent && (swapSourceStudent.name === lesson.name);

        const wrapper = document.createElement('div');
        wrapper.className = `lesson-card-wrapper ${wrapperExtraClass} ${noteFlagClass}`;

        const flipInner = document.createElement('div');
        flipInner.className = 'flip-card-inner';

        // Líc karty s maskovacím SVG růžkem
        const cardFront = document.createElement('div');
        cardFront.className = `flip-card-front lesson-card ${isSwapSource ? 'swap-mode' : ''} ${isSwapPending ? 'swap-pending' : ''} ${isAbsent ? 'absent' : ''} ${hasSub ? 'has-substitute' : ''} ${stripeClass} ${timeStatusClass}`;

        if (timeStatusClass === 'current-lesson') {
            cardFront.style.opacity = (1 - (progressPercent / 100) * 0.45).toFixed(2);
        }

        const cornerFoldHtml = hasCurrentWeekNote ? `
            <div class="card-corner-fold" role="button" aria-label="Otočit na poznámky" title="Otočit na poznámky">
                <svg viewBox="0 0 32 32" class="corner-fold-svg">
                    <!-- 1. Trojúhelník v barvě pozadí stránky, který překryje původní roh karty -->
                    <polygon points="0,0 32,0 32,32" class="fold-bg-mask" />
                    <!-- 2. Jemný stín pod ohnutým papírem -->
                    <polygon points="0,0 32,32 0,32" class="fold-shadow" />
                    <!-- 3. Odvrácená strana ohnutého papíru -->
                    <polygon points="0,0 32,32 0,32" class="fold-leaf" />
                    <!-- 4. Diagonální hrana ohybu -->
                    <line x1="0" y1="0" x2="32" y2="32" class="fold-line" />
                </svg>
            </div>` : '';

        cardFront.innerHTML = `
            ${cornerFoldHtml}
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

        cardFront.onclick = (e) => {
            if (swapSourceStudent !== null) {
                handleCardClick(index);
                return;
            }
            // Zkontroluje kliknutí na nový SVG růžek i starší třídu
            const foldBtn = e.target.closest('.card-corner-fold') || e.target.closest('.flip-corner-btn');
            if (foldBtn) {
                e.stopPropagation();
                e.preventDefault();
                toggleCardFlip(wrapper);
                return;
            }
            handleCardClick(index);
        };

        flipInner.appendChild(cardFront);

        // Rub karty
        if (hasCurrentWeekNote) {
            const cardBack = document.createElement('div');
            cardBack.className = 'flip-card-back';

            let historyChipsHtml = '';
            let initialText = lesson.notes;

            if (!isEvent) {
                const currentDayHuman = formatDateHuman(getDateForDay(currentDay, weekOffset));
                const timelineEntries = [{ date: currentDayHuman, notes: lesson.notes }];

                studentHistory.forEach(h => {
                    if (h.date !== currentDayHuman && h.notes) {
                        timelineEntries.push(h);
                    }
                });

                if (timelineEntries.length > 1) {
                    const chips = timelineEntries.map((entry, idx) => {
                        return `<button type="button" class="history-chip ${idx === 0 ? 'active' : ''}" data-content="${encodeURIComponent(entry.notes)}">${entry.date}</button>`;
                    });
                    historyChipsHtml = `<div class="note-history-chips">${chips.join('')}</div>`;
                }
            }

            cardBack.innerHTML = `
                <div>
                    <div class="flip-back-header">
                        <span class="flip-back-title">${isEvent ? (lesson.eventKind === 'concert' ? '🎻 Koncert' : '📋 Porada') : '📝 Zápisník žáka'}: ${lesson.name}</span>
                        <div class="flip-back-actions">
                            <button type="button" class="btn-card-edit-mini" title="Upravit hodinu / poznámku">✏️ Upravit</button>
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

// --- 10. Modál úprav a výběr z kalendáře ---
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

    // Dokončení výměny
    if (swapSourceStudent !== null) {
        const lessonB = effectiveLessons[index];
        const src = swapSourceStudent;
        swapSourceStudent = null;

        if (!lessonB.isEvent && src.name !== lessonB.name) {
            const activeMonday = getMonday(new Date(), weekOffset);
            const isoKey = getISOWeekKey(activeMonday);
            if (!weekOverrides[isoKey]) weekOverrides[isoKey] = {};

            const nameA = src.name;
            const nameB = lessonB.name;

            weekOverrides[isoKey][nameA] = {
                ...(weekOverrides[isoKey][nameA] || {}),
                swapPendingWith: {
                    partnerName: nameB,
                    name: nameB,
                    targetDay: lessonB.day,
                    targetTime: lessonB.time,
                    currentDay: src.day,
                    currentTime: src.time
                }
            };

            weekOverrides[isoKey][nameB] = {
                ...(weekOverrides[isoKey][nameB] || {}),
                swapPendingWith: {
                    partnerName: nameA,
                    name: src.name,
                    targetDay: src.day,
                    targetTime: src.time,
                    currentDay: lessonB.day,
                    currentTime: lessonB.time
                }
            };

            saveSchedule();
            renderTabs();
            renderSchedule();
            if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
            return;
        }

        renderTabs();
        renderSchedule();
        return;
    }

    // Otevření karty pro úpravu
    const lesson = effectiveLessons[index];
    const daySelect = document.getElementById('edit-day');
    if (daySelect) daySelect.value = lesson.day;

    const currentLessonDate = getDateForDay(lesson.day, weekOffset);

    const eventDateInput = document.getElementById('edit-event-date');
    if (eventDateInput) {
        eventDateInput.value = formatDateToInput(currentLessonDate);
    }

    const oldBanner = document.getElementById('modal-swap-approval-banner');
    if (oldBanner) oldBanner.remove();

    if (lesson.isEvent) {
        editingStudentName = null;
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
        editingStudentName = lesson.name;
        editingEventId = null;
        editingEventOldIso = null;
        setModalMode('lesson');
        document.getElementById('btn-swap').style.display = 'block';

        if (lesson.swapPendingWith) {
            const banner = document.createElement('div');
            banner.id = 'modal-swap-approval-banner';
            banner.className = 'swap-approval-banner';
            banner.innerHTML = `
                <div class="swap-approval-title">⇄ Plánovaná výměna za: <strong>${lesson.swapPendingWith.name}</strong> (${lesson.swapPendingWith.targetDay} v ${lesson.swapPendingWith.targetTime})</div>
                <div class="swap-approval-actions">
                    <button type="button" id="btn-approve-swap-action" class="btn-approve-swap">✓ Výměna schválena (prohodit)</button>
                    <button type="button" id="btn-cancel-swap-action" class="btn-cancel-swap">✕ Zrušit plánovanou výměnu</button>
                </div>
            `;

            const modalBody = document.querySelector('#edit-modal .modal');
            modalBody.insertBefore(banner, modalBody.firstChild);

            document.getElementById('btn-approve-swap-action').onclick = () => approveSwap(lesson);
            document.getElementById('btn-cancel-swap-action').onclick = () => cancelSwap(lesson);
        }

        document.getElementById('edit-time').value = lesson.time;
        const nameInput = document.getElementById('edit-name');
        nameInput.value = lesson.name;
        document.getElementById('edit-rocnik').value = lesson.rocnik || '';
        document.getElementById('edit-hn').value = lesson.hn || '';
        
        const notesInput = document.getElementById('edit-notes');
        notesInput.value = lesson.notes || '';

        const historyList = studentNotesHistory[lesson.name] || [];
        if (!lesson.notes && historyList.length > 0) {
            notesInput.placeholder = `Poslední zápis (${historyList[0].date}): ${historyList[0].notes.slice(0, 40)}...`;
        } else {
            notesInput.placeholder = "Skladby, cvičení, program, kontakt...";
        }

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
        const currentOverride = (weekOverrides[isoKey] && weekOverrides[isoKey][lesson.name]) || {};

        const editAbsentCheckbox = document.getElementById('edit-absent');
        const absentDateContainer = document.getElementById('absent-date-container');
        const editAbsentFrom = document.getElementById('edit-absent-from');
        const editAbsentTo = document.getElementById('edit-absent-to');
        const editAbsentDateInput = document.getElementById('edit-absent-date');
        const subSection = document.getElementById('substitute-section');
        const subCustom = document.getElementById('substitute-custom');
        const subSelect = document.getElementById('substitute-select');

        populateSubstituteSelect(lesson.name);

        const isCurrentlyAbsent = (currentOverride.absent !== undefined) ? currentOverride.absent : !!lesson.absent;
        editAbsentCheckbox.checked = isCurrentlyAbsent;

        const existingDateStr = (currentOverride.absentDate !== undefined ? currentOverride.absentDate : (lesson.absentDate || '')).trim();
        editAbsentDateInput.value = existingDateStr;

        if (existingDateStr) {
            if (existingDateStr.includes('-') || existingDateStr.includes('–')) {
                const sep = existingDateStr.includes('–') ? '–' : '-';
                const [fromStr, toStr] = existingDateStr.split(sep);
                const dFrom = parseSingleDate(fromStr);
                const dTo = parseSingleDate(toStr);
                editAbsentFrom.value = dFrom ? formatDateToInput(dFrom) : formatDateToInput(currentLessonDate);
                editAbsentTo.value = dTo ? formatDateToInput(dTo) : '';
            } else {
                const dSingle = parseSingleDate(existingDateStr);
                editAbsentFrom.value = dSingle ? formatDateToInput(dSingle) : formatDateToInput(currentLessonDate);
                editAbsentTo.value = '';
            }
        } else {
            editAbsentFrom.value = formatDateToInput(currentLessonDate);
            editAbsentTo.value = '';
        }

        document.getElementById('btn-absent-quick-today').onclick = () => {
            editAbsentFrom.value = formatDateToInput(currentLessonDate);
            editAbsentTo.value = '';
        };

        document.getElementById('btn-absent-quick-week').onclick = () => {
            const monday = getMonday(currentLessonDate, 0);
            const friday = new Date(monday);
            friday.setDate(monday.getDate() + 4);
            editAbsentFrom.value = formatDateToInput(monday);
            editAbsentTo.value = formatDateToInput(friday);
        };

        subCustom.value = currentOverride.substitute !== undefined ? currentOverride.substitute : (lesson.substitute || '');
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

// 1. Schválení výměny
function approveSwap(lesson) {
    const activeMonday = getMonday(new Date(), weekOffset);
    const isoKey = getISOWeekKey(activeMonday);
    if (!weekOverrides[isoKey]) return;

    const swapInfo = lesson.swapPendingWith;
    if (!swapInfo) return;

    const nameA = lesson.name;
    const nameB = swapInfo.partnerName;

    if (weekOverrides[isoKey][nameA]) {
        weekOverrides[isoKey][nameA].effectiveDay = swapInfo.targetDay;
        weekOverrides[isoKey][nameA].time = swapInfo.targetTime;
        delete weekOverrides[isoKey][nameA].swapPendingWith;
    }
    if (nameB && weekOverrides[isoKey][nameB]) {
        weekOverrides[isoKey][nameB].effectiveDay = swapInfo.currentDay;
        weekOverrides[isoKey][nameB].time = swapInfo.currentTime;
        delete weekOverrides[isoKey][nameB].swapPendingWith;
    }

    saveSchedule();
    document.getElementById('edit-modal').classList.add('hidden');
    renderTabs();
    renderSchedule();
    if (navigator.vibrate) navigator.vibrate([40, 60, 40]);
}

// 2. Zrušení plánované výměny
function cancelSwap(lesson) {
    const activeMonday = getMonday(new Date(), weekOffset);
    const isoKey = getISOWeekKey(activeMonday);
    if (!weekOverrides[isoKey]) return;

    const swapInfo = lesson.swapPendingWith;
    if (!swapInfo) return;

    const nameA = lesson.name;
    const nameB = swapInfo.partnerName;

    if (weekOverrides[isoKey][nameA]) {
        delete weekOverrides[isoKey][nameA].swapPendingWith;
    }
    if (nameB && weekOverrides[isoKey][nameB]) {
        delete weekOverrides[isoKey][nameB].swapPendingWith;
    }

    saveSchedule();
    document.getElementById('edit-modal').classList.add('hidden');
    renderTabs();
    renderSchedule();
    if (navigator.vibrate) navigator.vibrate(50);
}

document.getElementById('btn-cancel').onclick = () => document.getElementById('edit-modal').classList.add('hidden');

// ULOŽENÍ HODINY
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
    const newName = document.getElementById('edit-name').value.trim();

    if (!newName) {
        alert("Zadejte prosím jméno žáka.");
        return;
    }

    const isPriv = document.getElementById('edit-private').checked;
    const newTime = document.getElementById('edit-time').value;
    const isAbs = document.getElementById('edit-absent').checked;
    const subVal = document.getElementById('substitute-custom').value.trim();
    const notesVal = document.getElementById('edit-notes').value.trim();

    // Formátování data omluvenky
    let absDate = '';
    if (isAbs) {
        const dFrom = parseInputDate(document.getElementById('edit-absent-from').value);
        const dTo = parseInputDate(document.getElementById('edit-absent-to').value);

        if (dFrom && dTo && dTo.getTime() > dFrom.getTime()) {
            absDate = `${dFrom.getDate()}.${dFrom.getMonth() + 1}. – ${dTo.getDate()}.${dTo.getMonth() + 1}.`;
        } else if (dFrom) {
            absDate = `${dFrom.getDate()}.${dFrom.getMonth() + 1}.`;
        }
    }

    const rocnikVal = isPriv ? '' : document.getElementById('edit-rocnik').value.trim();
    const hnVal = isPriv ? '' : document.getElementById('edit-hn').value.trim();
    const ensembleVal = isPriv ? false : document.getElementById('edit-ensemble').checked;
    const radYounger = document.getElementById('ensemble-younger');
    const ensembleGroupVal = isPriv ? 'older' : ((radYounger && radYounger.checked) ? 'younger' : 'older');

    // A) PŘIDÁNÍ NOVÉHO ŽÁKA
    if (!editingStudentName) {
        const newLesson = {
            time: newTime,
            name: newName,
            rocnik: rocnikVal,
            hn: hnVal,
            isPrivate: isPriv,
            ensemble: ensembleVal,
            ensembleGroup: ensembleGroupVal,
            absent: false,
            notes: ''
        };

        if (!masterSchedule[targetDay]) masterSchedule[targetDay] = [];
        masterSchedule[targetDay].push(newLesson);
        masterSchedule[targetDay].sort((a, b) => a.time.localeCompare(b.time));

        currentDay = targetDay;
    } 
    // B) ÚPRAVA NEBO PŘESUN EXISTUJÍCÍHO ŽÁKA
    else {
        let foundDay = null;
        let foundIdx = -1;

        for (let d of workDays) {
            if (Array.isArray(masterSchedule[d])) {
                const idx = masterSchedule[d].findIndex(l => l.name === editingStudentName);
                if (idx !== -1) {
                    foundDay = d;
                    foundIdx = idx;
                    break;
                }
            }
        }

        if (foundDay && foundIdx !== -1) {
            const lessonObj = masterSchedule[foundDay][foundIdx];
            lessonObj.time = newTime;
            lessonObj.name = newName;
            lessonObj.isPrivate = isPriv;
            lessonObj.rocnik = rocnikVal;
            lessonObj.hn = hnVal;
            lessonObj.ensemble = ensembleVal;
            lessonObj.ensembleGroup = ensembleGroupVal;
            lessonObj.absent = false;

            if (targetDay !== foundDay) {
                masterSchedule[foundDay].splice(foundIdx, 1);
                if (!masterSchedule[targetDay]) masterSchedule[targetDay] = [];
                masterSchedule[targetDay].push(lessonObj);
                masterSchedule[targetDay].sort((a, b) => a.time.localeCompare(b.time));

                if (newName !== editingStudentName && weekOverrides[isoKey][editingStudentName]) {
                    delete weekOverrides[isoKey][editingStudentName];
                }
                currentDay = targetDay;
            }
        } else {
            if (!masterSchedule[targetDay]) masterSchedule[targetDay] = [];
            masterSchedule[targetDay].push({
                time: newTime,
                name: newName,
                rocnik: rocnikVal,
                hn: hnVal,
                isPrivate: isPriv,
                ensemble: ensembleVal,
                ensembleGroup: ensembleGroupVal,
                absent: false,
                notes: ''
            });
            masterSchedule[targetDay].sort((a, b) => a.time.localeCompare(b.time));
            currentDay = targetDay;
        }
    }

    const lessonDateHuman = formatDateHuman(getDateForDay(targetDay, weekOffset));
    let noteHistoryPayload = null;

    if (notesVal) {
        noteHistoryPayload = {
            date: lessonDateHuman,
            student: newName,
            notes: notesVal
        };
        if (!studentNotesHistory[newName]) studentNotesHistory[newName] = [];
        studentNotesHistory[newName] = studentNotesHistory[newName].filter(h => h.date !== lessonDateHuman);
        studentNotesHistory[newName].unshift({ date: lessonDateHuman, notes: notesVal });
    } else {
        if (studentNotesHistory[newName]) {
            studentNotesHistory[newName] = studentNotesHistory[newName].filter(h => h.date !== lessonDateHuman);
        }
    }

    const oldKey = editingStudentName || newName;
    const existingData = weekOverrides[isoKey][newName] || weekOverrides[isoKey][oldKey] || {};
    if (editingStudentName && newName !== editingStudentName && weekOverrides[isoKey][editingStudentName]) {
        delete weekOverrides[isoKey][editingStudentName];
    }

    weekOverrides[isoKey][newName] = {
        ...existingData,
        time: newTime,
        absent: isAbs,
        absentDate: isAbs ? absDate : '',
        substitute: (isAbs && subVal) ? subVal : '',
        notes: notesVal
    };

    saveSchedule(noteHistoryPayload);
    renderTabs();
    renderSchedule();
    document.getElementById('edit-modal').classList.add('hidden');
};

// Výměna žáka
document.getElementById('btn-swap').onclick = () => {
    const effectiveLessons = getEffectiveDayLessons(currentDay);
    const lessonObj = effectiveLessons.find(l => !l.isEvent && l.name === editingStudentName);

    if (lessonObj) {
        swapSourceStudent = {
            day: lessonObj.day,
            name: lessonObj.name,
            time: lessonObj.time
        };
    }

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

    if (editingStudentName && confirm('Opravdu chcete tuto hodinu smazat z kmenového rozvrhu?')) {
        for (let d of workDays) {
            if (Array.isArray(masterSchedule[d])) {
                const idx = masterSchedule[d].findIndex(l => l.name === editingStudentName);
                if (idx !== -1) {
                    masterSchedule[d].splice(idx, 1);
                    break;
                }
            }
        }
        const activeMonday = getMonday(new Date(), weekOffset);
        const isoKey = getISOWeekKey(activeMonday);
        if (weekOverrides[isoKey]) delete weekOverrides[isoKey][editingStudentName];

        saveSchedule();
        renderTabs();
        renderSchedule();
        document.getElementById('edit-modal').classList.add('hidden');
    }
};

document.getElementById('add-lesson-btn').onclick = () => {
    editingStudentName = null;
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
    document.getElementById('edit-absent-from').value = formatDateToInput(getDateForDay(currentDay, weekOffset));
    document.getElementById('edit-absent-to').value = "";
    document.getElementById('substitute-custom').value = "";

    const oldBanner = document.getElementById('modal-swap-approval-banner');
    if (oldBanner) oldBanner.remove();

    document.getElementById('edit-modal').classList.remove('hidden');
};

document.getElementById('add-event-btn').onclick = () => {
    editingStudentName = null;
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

    const oldBanner = document.getElementById('modal-swap-approval-banner');
    if (oldBanner) oldBanner.remove();

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

// Gesta pro posun dnů
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

    const swipeDist = touchEndX - touchStartX;
    const threshold = 45; // Snížený práh pro svižnější reakci prstu

    // Švih doleva -> další den
    if (swipeDist < -threshold && idx < workDays.length - 1) {
        currentDay = workDays[idx + 1];
        if (navigator.vibrate) navigator.vibrate(18); // Lehká haptická odezva
        renderTabs();
        renderSchedule('right');
    }
    // Švih doprava -> předchozí den
    else if (swipeDist > threshold && idx > 0) {
        currentDay = workDays[idx - 1];
        if (navigator.vibrate) navigator.vibrate(18); // Lehká haptická odezva
        renderTabs();
        renderSchedule('left');
    }
}, { passive: true });

setInterval(() => {
    if (weekOffset === 0) renderSchedule();
}, 60000);

// --- 12. Správa tématu a systémové lišty ---
function initTheme() {
    const btnTheme = document.getElementById('btn-theme');
    const sunIcon = document.getElementById('icon-theme-sun');
    const moonIcon = document.getElementById('icon-theme-moon');

    function updateSystemStatusBar(theme) {
    const isDark = (theme === 'dark');
    // Přesné barvy ladící k záhlaví splývajícímu s pozadím:
    const targetColor = isDark ? '#141211' : '#f1e6d4';

    document.querySelectorAll('meta[name="theme-color"]').forEach(el => el.remove());
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = targetColor;
    document.head.appendChild(meta);

    const appleMeta = document.getElementById('apple-status-bar-meta');
    if (appleMeta) {
        appleMeta.content = isDark ? 'black-translucent' : 'default';
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

// Spuštění
initTheme();
updateWeekStepperUI();
renderTabs();
renderSchedule();
fetchCloudSchedule(true);