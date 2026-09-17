// Rozvrh ZUŠ Kytara – Klientská logika s podporou Google Apps Script backendu

const CONFIG = {
    GAS_URL: "https://script.google.com/macros/s/AKfycbzbn-loEtgL8Q96wbLrqR9Jluff6YSdmnVxnjnmULq0OMTAsFgjAaEjn77hw66aqjel/exec",
    SCHOOL_YEAR_START: '2026-09-01'
};

const workDays = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'];

let scheduleData = {};
let weeklyExceptions = {};
let lessonNotes = {};
let currentWeekNumber = 1;
let currentDay = 'Pondělí';
let currentFlippedWrapper = null;
let swapSourceStudent = null;
let editingLessonIndex = null;

let touchStartX = 0;
let touchEndX = 0;

// Výchozí prázdná data při prvním spuštění
function getEmptySchedule() {
    return {
        'Pondělí': [],
        'Úterý': [],
        'Středa': [],
        'Čtvrtek': [],
        'Pátek': []
    };
}

// Inicializace aplikace
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    loadLocalData();
    setupEventListeners();
    determineInitialWeekAndDay();
    renderTabs();
    renderSchedule();
    syncWithBackend();

    setInterval(updateLessonProgress, 60000);
});

// Správa motivu a synchronizace systémové stavové lišty
function initTheme() {
    const savedTheme = localStorage.getItem('zus_theme');
    const systemDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (systemDark ? 'dark' : 'light');

    applyTheme(theme);

    const toggleBtn = document.getElementById('theme-toggle-btn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const isDark = document.documentElement.classList.contains('theme-dark');
            const newTheme = isDark ? 'light' : 'dark';
            applyTheme(newTheme);
            localStorage.setItem('zus_theme', newTheme);
        });
    }

    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
            if (!localStorage.getItem('zus_theme')) {
                applyTheme(e.matches ? 'dark' : 'light');
            }
        });
    }
}

function applyTheme(theme) {
    const isDark = (theme === 'dark');
    document.documentElement.classList.toggle('theme-dark', isDark);
    document.documentElement.classList.toggle('theme-light', !isDark);

    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    if (sunIcon && moonIcon) {
        sunIcon.classList.toggle('hidden', !isDark);
        moonIcon.classList.toggle('hidden', isDark);
    }

    updateSystemStatusBar(theme);
}

function updateSystemStatusBar(theme) {
    const isDark = (theme === 'dark');
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

// Načtení dat z localStorage
function loadLocalData() {
    const localSched = localStorage.getItem('zus_schedule');
    const localExc = localStorage.getItem('zus_exceptions');
    const localNotes = localStorage.getItem('zus_notes');

    scheduleData = localSched ? JSON.parse(localSched) : getEmptySchedule();
    weeklyExceptions = localExc ? JSON.parse(localExc) : {};
    lessonNotes = localNotes ? JSON.parse(localNotes) : {};
}

function saveLocalData() {
    localStorage.setItem('zus_schedule', JSON.stringify(scheduleData));
    localStorage.setItem('zus_exceptions', JSON.stringify(weeklyExceptions));
    localStorage.setItem('zus_notes', JSON.stringify(lessonNotes));
}

// Výpočet kalendářního týdne školního roku
function getSchoolWeekNumber(date = new Date()) {
    const start = new Date(CONFIG.SCHOOL_YEAR_START);
    const dayOfWeek = start.getDay() || 7;
    start.setDate(start.getDate() - (dayOfWeek - 1));
    start.setHours(0, 0, 0, 0);

    const current = new Date(date);
    current.setHours(0, 0, 0, 0);

    const diffWeeks = Math.floor((current - start) / (7 * 24 * 60 * 60 * 1000));
    return Math.max(1, diffWeeks + 1);
}

function getDateOfWeek(weekNum, dayIndex) {
    const start = new Date(CONFIG.SCHOOL_YEAR_START);
    const dayOfWeek = start.getDay() || 7;
    start.setDate(start.getDate() - (dayOfWeek - 1));
    start.setHours(0, 0, 0, 0);

    const target = new Date(start.getTime() + ((weekNum - 1) * 7 + dayIndex) * 24 * 60 * 60 * 1000);
    return target;
}

function determineInitialWeekAndDay() {
    const now = new Date();
    currentWeekNumber = getSchoolWeekNumber(now);

    const day = now.getDay();
    if (day >= 1 && day <= 5) {
        currentDay = workDays[day - 1];
    } else {
        currentDay = 'Pondělí';
    }
}

// Render záložek dnů a záhlaví
function renderTabs() {
    const daySelector = document.getElementById('day-selector');
    daySelector.innerHTML = '';

    const currentWeekRange = document.getElementById('current-week-range');
    const mondayDate = getDateOfWeek(currentWeekNumber, 0);
    const fridayDate = getDateOfWeek(currentWeekNumber, 4);

    const fmt = (d) => `${d.getDate()}. ${d.getMonth() + 1}.`;
    currentWeekRange.textContent = `${fmt(mondayDate)} – ${fmt(fridayDate)}`;

    const weekLabel = document.getElementById('current-week-label');
    weekLabel.innerHTML = `Týden ${currentWeekNumber} <span class="dropdown-chevron">▼</span>`;

    const realWeek = getSchoolWeekNumber(new Date());
    const realDayIdx = (new Date().getDay() || 7) - 1;
    const isCurrentRealWeek = (currentWeekNumber === realWeek);

    const btnToday = document.getElementById('btn-today');
    if (btnToday) {
        const isExactToday = isCurrentRealWeek && (realDayIdx >= 0 && realDayIdx <= 4 && workDays[realDayIdx] === currentDay);
        btnToday.classList.toggle('hidden', isExactToday);
    }

    workDays.forEach((day, idx) => {
        const btn = document.createElement('button');
        if (day === currentDay) btn.className = 'active';

        const dDate = getDateOfWeek(currentWeekNumber, idx);
        const dayNum = `${dDate.getDate()}. ${dDate.getMonth() + 1}.`;

        const dots = getDayDotsHtml(day);

        btn.innerHTML = `
            <span class="tab-day-name">${day.substring(0, 2)}</span>
            <span class="tab-day-date">${dayNum}</span>
            <div class="day-dots-container">${dots}</div>
        `;

        btn.onclick = () => {
            if (currentDay === day) return;
            const oldIdx = workDays.indexOf(currentDay);
            const dir = (idx > oldIdx) ? 'right' : 'left';
            currentDay = day;
            renderTabs();
            renderSchedule(dir);
        };

        daySelector.appendChild(btn);
    });
}

function getDayDotsHtml(day) {
    const lessons = scheduleData[day] || [];
    let hasAbsent = false;
    let hasConcert = false;
    let hasMeeting = false;

    lessons.forEach(l => {
        const override = getWeeklyOverride(l.name);
        if (override && override.isAbsent) hasAbsent = true;
        if (l.isEvent) {
            if (l.eventTier === 'koncert') hasConcert = true;
            if (l.eventTier === 'porada') hasMeeting = true;
        }
    });

    let html = '';
    if (hasAbsent) html += '<span class="day-dot dot-absent" title="Omluvený žák"></span>';
    if (hasConcert) html += '<span class="day-dot dot-concert" title="Koncert"></span>';
    if (hasMeeting) html += '<span class="day-dot dot-meeting" title="Porada"></span>';
    return html;
}

// Vykreslení seznamu hodin a akcí pro aktuální den
function renderSchedule(animationDir = null) {
    resetCardFlip();
    const container = document.getElementById('schedule-container');
    container.innerHTML = '';

    if (animationDir === 'right') {
        container.className = 'slide-from-right';
    } else if (animationDir === 'left') {
        container.className = 'slide-from-left';
    } else {
        container.className = '';
    }

    const lessons = (scheduleData[currentDay] || []).slice();
    lessons.sort((a, b) => a.time.localeCompare(b.time));

    const now = new Date();
    const realWeek = getSchoolWeekNumber(now);
    const realDayIdx = (now.getDay() || 7) - 1;
    const isToday = (currentWeekNumber === realWeek && realDayIdx >= 0 && realDayIdx <= 4 && workDays[realDayIdx] === currentDay);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    let previousEndMinutes = null;

    lessons.forEach((lesson, index) => {
        const startMinutes = timeToMinutes(lesson.time);
        const duration = parseInt(lesson.duration || 45, 10);
        const endMinutes = startMinutes + duration;
        const endTime = minutesToTime(endMinutes);

        // Kompaktní ukazatel pauzy mezi hodinami
        if (previousEndMinutes !== null) {
            const pauseMinutes = startMinutes - previousEndMinutes;
            if (pauseMinutes > 0) {
                const breakEl = document.createElement('div');
                breakEl.className = 'break-indicator';
                breakEl.textContent = `Pauza ${pauseMinutes} min`;
                container.appendChild(breakEl);
            }
        }
        previousEndMinutes = endMinutes;

        const override = getWeeklyOverride(lesson.name);
        const isAbsent = override ? override.isAbsent : false;
        const hasSub = override && override.substitute && override.substitute.name;
        const isSwapPending = override && override.swapPending;
        const isSwapSource = (swapSourceStudent === lesson.name);

        let timeStatusClass = '';
        let progressPercent = 0;

        if (isToday) {
            if (nowMinutes > endMinutes) {
                timeStatusClass = 'past-lesson';
            } else if (nowMinutes >= startMinutes && nowMinutes <= endMinutes) {
                timeStatusClass = 'current-lesson';
                progressPercent = Math.min(100, Math.max(0, Math.round(((nowMinutes - startMinutes) / duration) * 100)));
            }
        }

        const wrapper = document.createElement('div');
        wrapper.className = `lesson-card-wrapper ${lesson.isEvent ? `event-${lesson.eventTier || 'concert'}-wrapper` : ''}`;

        const flipInner = document.createElement('div');
        flipInner.className = 'flip-card-inner';

        let stripeClass = '';
        let titleColorClass = '';
        if (lesson.isEvent) {
            stripeClass = (lesson.eventTier === 'porada') ? 'event-meeting' : 'event-concert';
        } else if (lesson.isEnsemble) {
            stripeClass = (lesson.ensembleTier === 'starsi') ? 'ensemble-gold' : 'ensemble-purple';
            titleColorClass = (lesson.ensembleTier === 'starsi') ? 'ensemble-title-older' : 'ensemble-title-younger';
        } else if (lesson.isPrivate) {
            stripeClass = 'private-card';
        }

        let absentBadge = isAbsent ? '<span class="badge-absent">Omluven</span>' : '';
        let detailsHtml = '';

        if (lesson.isEvent) {
            const chipClass = (lesson.eventTier === 'porada') ? 'meeting' : 'concert';
            const chipLabel = (lesson.eventTier === 'porada') ? 'Porada' : 'Vystoupení';
            detailsHtml = `<span class="event-chip ${chipClass}">${chipLabel}</span>${lesson.location || 'Koncertní sál'}`;
        } else if (lesson.isEnsemble) {
            detailsHtml = (lesson.ensembleTier === 'starsi') ? 'Starší soubor' : 'Mladší soubor';
        } else {
            detailsHtml = lesson.rocnik ? `Ročník: ${lesson.rocnik}` : 'Kytara';
        }

        const studentNotes = lessonNotes[lesson.name] || {};
        const hasCurrentWeekNote = Boolean(studentNotes[currentWeekNumber] && studentNotes[currentWeekNumber].trim());
        if (hasCurrentWeekNote) {
            wrapper.classList.add('has-note');
        }

        // Líc karty s maskovacím SVG růžkem
        const cardFront = document.createElement('div');
        cardFront.className = `flip-card-front lesson-card ${isSwapSource ? 'swap-mode' : ''} ${isSwapPending ? 'swap-pending' : ''} ${isAbsent ? 'absent' : ''} ${hasSub ? 'has-substitute' : ''} ${stripeClass} ${timeStatusClass}`;

        if (timeStatusClass === 'current-lesson') {
            cardFront.style.opacity = (1 - (progressPercent / 100) * 0.45).toFixed(2);
        }

        const cornerFoldHtml = hasCurrentWeekNote ? `
            <div class="card-corner-fold" role="button" aria-label="Otočit na poznámky" title="Otočit na poznámky">
                <svg viewBox="0 0 32 32" class="corner-fold-svg">
                    <polygon points="0,0 32,0 32,32" class="fold-bg-mask" />
                    <polygon points="0,0 32,32 0,32" class="fold-shadow" />
                    <polygon points="0,0 32,32 0,32" class="fold-leaf" />
                    <line x1="0" y1="0" x2="32" y2="32" class="fold-line" />
                </svg>
            </div>
        ` : '';

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
                ${isSwapPending ? '<div class="swap-badge">Čeká na schválení výměny</div>' : ''}
            </div>
            ${timeStatusClass === 'current-lesson' ? `<div class="lesson-progress-bar" style="width: ${progressPercent}%;"></div>` : ''}
        `;

        cardFront.onclick = (e) => {
            if (swapSourceStudent !== null) {
                handleCardClick(index);
                return;
            }

            const foldBtn = e.target.closest('.card-corner-fold');
            if (foldBtn) {
                e.stopPropagation();
                e.preventDefault();
                toggleCardFlip(wrapper);
                return;
            }

            handleCardClick(index);
        };

        flipInner.appendChild(cardFront);

        if (hasSub) {
            const subCard = document.createElement('div');
            subCard.className = 'substitute-badge-card';
            subCard.innerHTML = `
                <div>
                    <div class="sub-title">Zástup / Náhrada</div>
                    <div class="sub-name">${override.substitute.name}</div>
                </div>
                <span class="sub-tag">Zástup</span>
            `;
            subCard.onclick = (e) => {
                e.stopPropagation();
                openEditModal(index);
            };
            container.appendChild(wrapper);
            container.appendChild(subCard);
        } else {
            container.appendChild(wrapper);
        }

        // Rub karty – zápisník
        const cardBack = document.createElement('div');
        cardBack.className = 'flip-card-back';

        const historyWeeks = Object.keys(studentNotes).map(Number).sort((a, b) => b - a);
        let chipsHtml = '';
        historyWeeks.forEach(w => {
            chipsHtml += `<button type="button" class="history-chip ${w === currentWeekNumber ? 'active' : ''}" data-week="${w}">Týden ${w}</button>`;
        });

        const activeNoteText = studentNotes[currentWeekNumber] || 'Žádný záznam pro tento týden.';

        cardBack.innerHTML = `
            <div class="flip-back-header">
                <span class="flip-back-title">Zápisník – ${lesson.name}</span>
                <button type="button" class="btn-card-edit-mini" title="Upravit zápis">Upravit</button>
            </div>
            ${historyWeeks.length > 1 ? `<div class="note-history-chips">${chipsHtml}</div>` : ''}
            <div class="flip-back-body">${activeNoteText}</div>
            <div class="flip-back-footer">Klepnutím otočit zpět</div>
        `;

        cardBack.onclick = (e) => {
            if (e.target.classList.contains('history-chip')) {
                e.stopPropagation();
                const selWeek = parseInt(e.target.dataset.week, 10);
                cardBack.querySelectorAll('.history-chip').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                cardBack.querySelector('.flip-back-body').textContent = studentNotes[selWeek] || 'Bez záznamu.';
                return;
            }

            if (e.target.classList.contains('btn-card-edit-mini')) {
                e.stopPropagation();
                toggleCardFlip(wrapper);
                openEditModal(index);
                return;
            }

            toggleCardFlip(wrapper);
        };

        flipInner.appendChild(cardBack);
        wrapper.appendChild(flipInner);
    });

    if (lessons.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; color: var(--text-secondary);">
                Žádné hodiny pro tento den. Klepněte na <b>Přidat</b> níže.
            </div>
        `;
    }
}

// 3D rotace karty
function toggleCardFlip(wrapper) {
    if (currentFlippedWrapper && currentFlippedWrapper !== wrapper) {
        currentFlippedWrapper.classList.remove('flipped');
        currentFlippedWrapper.classList.remove('is-active-flipped');
    }

    const isFlipped = wrapper.classList.toggle('flipped');
    wrapper.classList.toggle('is-active-flipped', isFlipped);

    if (isFlipped) {
        currentFlippedWrapper = wrapper;
        document.body.classList.add('is-card-flipped-active');
    } else {
        currentFlippedWrapper = null;
        document.body.classList.remove('is-card-flipped-active');
    }
}

function resetCardFlip() {
    if (currentFlippedWrapper) {
        currentFlippedWrapper.classList.remove('flipped');
        currentFlippedWrapper.classList.remove('is-active-flipped');
        currentFlippedWrapper = null;
    }
    document.body.classList.remove('is-card-flipped-active');
}

// Obsluha kliknutí na kartu
function handleCardClick(index) {
    const lessons = scheduleData[currentDay] || [];
    const lesson = lessons[index];
    if (!lesson) return;

    if (swapSourceStudent !== null) {
        if (swapSourceStudent === lesson.name) {
            cancelSwapMode();
            return;
        }

        requestStudentSwap(swapSourceStudent, lesson.name);
        return;
    }

    openEditModal(index);
}

function startSwapMode() {
    alert('Klepněte na kartu prvního žáka, kterého chcete prohodit.');
    swapSourceStudent = '__WAITING__';
}

function cancelSwapMode() {
    swapSourceStudent = null;
    renderSchedule();
}

function requestStudentSwap(studentA, studentB) {
    const overrideA = getOrCreateOverride(studentA);
    const overrideB = getOrCreateOverride(studentB);

    overrideA.swapPending = { withStudent: studentB, requestedWeek: currentWeekNumber };
    overrideB.swapPending = { withStudent: studentA, requestedWeek: currentWeekNumber };

    saveLocalData();
    swapSourceStudent = null;
    renderSchedule();
    syncWithBackend();
    alert(`Žádost o prohození žáků ${studentA} a ${studentB} byla uložena.`);
}

function approveSwap(studentName) {
    const override = getWeeklyOverride(studentName);
    if (!override || !override.swapPending) return;

    const partnerName = override.swapPending.withStudent;
    let slotA = findStudentSlot(studentName);
    let slotB = findStudentSlot(partnerName);

    if (slotA && slotB) {
        const studentAData = scheduleData[slotA.day][slotA.index];
        const studentBData = scheduleData[slotB.day][slotB.index];

        const tempTime = studentAData.time;
        const tempDay = slotA.day;

        studentAData.time = studentBData.time;
        scheduleData[slotB.day].push(studentAData);
        scheduleData[slotA.day].splice(slotA.index, 1);

        studentBData.time = tempTime;
        scheduleData[tempDay].push(studentBData);
        const newBIndex = scheduleData[slotB.day].indexOf(studentBData);
        if (newBIndex > -1) scheduleData[slotB.day].splice(newBIndex, 1);
    }

    delete override.swapPending;
    const partnerOverride = getWeeklyOverride(partnerName);
    if (partnerOverride) delete partnerOverride.swapPending;

    saveLocalData();
    closeEditModal();
    renderSchedule();
    syncWithBackend();
    alert('Výměna žáků byla schválena a rozvrh aktualizován.');
}

function cancelPendingSwap(studentName) {
    const override = getWeeklyOverride(studentName);
    if (!override || !override.swapPending) return;

    const partnerName = override.swapPending.withStudent;
    delete override.swapPending;

    const partnerOverride = getWeeklyOverride(partnerName);
    if (partnerOverride) delete partnerOverride.swapPending;

    saveLocalData();
    closeEditModal();
    renderSchedule();
    syncWithBackend();
}

// Správa modálního okna
function openEditModal(index = null) {
    editingLessonIndex = index;
    const modal = document.getElementById('edit-modal');
    const form = document.getElementById('edit-form');
    form.reset();

    const dangerZone = document.getElementById('modal-danger-zone');
    const swapBanner = document.getElementById('swap-approval-banner');
    const substituteContainer = document.getElementById('substitute-container');
    const notesGroup = document.getElementById('notes-group');

    populateSubstituteDropdown();

    if (index !== null) {
        const lesson = scheduleData[currentDay][index];
        dangerZone.classList.remove('hidden');
        notesGroup.classList.remove('hidden');

        if (lesson.isEvent) {
            setModalType('event');
            document.getElementById('edit-event-name').value = lesson.name || '';
            document.getElementById('edit-event-location').value = lesson.location || '';
            const tierRadio = document.querySelector(`input[name="event-tier"][value="${lesson.eventTier || 'koncert'}"]`);
            if (tierRadio) tierRadio.checked = true;
            substituteContainer.classList.add('hidden');
        } else {
            setModalType('student');
            document.getElementById('edit-name').value = lesson.name || '';
            document.getElementById('edit-rocnik').value = lesson.rocnik || '';
            document.getElementById('edit-gender').value = lesson.gender || 'chlapec';
            document.getElementById('edit-is-private').checked = Boolean(lesson.isPrivate);
            document.getElementById('edit-is-ensemble').checked = Boolean(lesson.isEnsemble);

            const ensembleBox = document.getElementById('ensemble-tier-container');
            ensembleBox.classList.toggle('hidden', !lesson.isEnsemble);
            const ensRadio = document.querySelector(`input[name="ensemble-tier"][value="${lesson.ensembleTier || 'mladsi'}"]`);
            if (ensRadio) ensRadio.checked = true;

            substituteContainer.classList.remove('hidden');
            const override = getWeeklyOverride(lesson.name);
            if (override && override.substitute) {
                document.getElementById('substitute-select').value = override.substitute.name || '';
                document.getElementById('substitute-manual').value = override.substitute.isManual ? override.substitute.name : '';
            }

            const btnAbsent = document.getElementById('btn-toggle-absent');
            const isAbsent = override ? override.isAbsent : false;
            btnAbsent.textContent = isAbsent ? 'Zrušit omluvenku' : 'Označit omluven';

            if (override && override.swapPending) {
                swapBanner.classList.remove('hidden');
                document.getElementById('swap-approval-text').textContent =
                    `Čeká na schválení výměny s žákem: ${override.swapPending.withStudent}`;
                document.getElementById('btn-approve-swap').onclick = () => approveSwap(lesson.name);
                document.getElementById('btn-cancel-swap').onclick = () => cancelPendingSwap(lesson.name);
            } else {
                swapBanner.classList.add('hidden');
            }
        }

        document.getElementById('edit-time').value = lesson.time || '13:00';
        document.getElementById('edit-duration').value = lesson.duration || 45;

        const studentNotes = lessonNotes[lesson.name] || {};
        document.getElementById('edit-notes').value = studentNotes[currentWeekNumber] || '';

    } else {
        dangerZone.classList.add('hidden');
        swapBanner.classList.add('hidden');
        substituteContainer.classList.add('hidden');
        setModalType('student');

        const lessons = scheduleData[currentDay] || [];
        if (lessons.length > 0) {
            const last = lessons[lessons.length - 1];
            const nextStart = timeToMinutes(last.time) + parseInt(last.duration || 45, 10);
            document.getElementById('edit-time').value = minutesToTime(nextStart);
        } else {
            document.getElementById('edit-time').value = '13:00';
        }
        document.getElementById('edit-duration').value = 45;
    }

    modal.classList.remove('hidden');
}

function closeEditModal() {
    document.getElementById('edit-modal').classList.add('hidden');
    editingLessonIndex = null;
}

function setModalType(type) {
    const isStudent = (type === 'student');
    document.querySelectorAll('.type-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.type === type);
    });

    document.getElementById('student-only-fields').classList.toggle('hidden', !isStudent);
    document.getElementById('event-only-fields').classList.toggle('hidden', isStudent);

    const editName = document.getElementById('edit-name');
    const editEventName = document.getElementById('edit-event-name');
    if (isStudent) {
        editName.required = true;
        editEventName.required = false;
    } else {
        editName.required = false;
        editEventName.required = true;
    }
}

function populateSubstituteDropdown() {
    const select = document.getElementById('substitute-select');
    select.innerHTML = '<option value="">-- Bez zástupu / Vyberte žáka --</option>';

    const allStudents = [];
    workDays.forEach(d => {
        (scheduleData[d] || []).forEach(l => {
            if (!l.isEvent && l.name && !allStudents.includes(l.name)) {
                allStudents.push(l.name);
            }
        });
    });
    allStudents.sort();

    allStudents.forEach(st => {
        const opt = document.createElement('option');
        opt.value = st;
        opt.textContent = st;
        select.appendChild(opt);
    });
}

// Uložení formuláře
document.getElementById('edit-form').addEventListener('submit', e => {
    e.preventDefault();

    const isStudent = document.querySelector('.type-btn[data-type="student"]').classList.contains('active');
    const time = document.getElementById('edit-time').value;
    const duration = parseInt(document.getElementById('edit-duration').value, 10);

    let lessonObj = { time, duration };

    if (isStudent) {
        const name = document.getElementById('edit-name').value.trim();
        const rocnik = document.getElementById('edit-rocnik').value.trim();
        const gender = document.getElementById('edit-gender').value;
        const isPrivate = document.getElementById('edit-is-private').checked;
        const isEnsemble = document.getElementById('edit-is-ensemble').checked;
        const ensembleTier = isEnsemble ? document.querySelector('input[name="ensemble-tier"]:checked').value : null;

        lessonObj = {
            ...lessonObj,
            name,
            rocnik,
            gender,
            isPrivate,
            isEnsemble,
            ensembleTier,
            isEvent: false
        };

        const subSelect = document.getElementById('substitute-select').value;
        const subManual = document.getElementById('substitute-manual').value.trim();
        const subName = subManual || subSelect;

        if (subName) {
            const override = getOrCreateOverride(name);
            override.substitute = { name: subName, isManual: Boolean(subManual) };
        } else {
            const override = getWeeklyOverride(name);
            if (override) delete override.substitute;
        }

        const noteText = document.getElementById('edit-notes').value.trim();
        if (!lessonNotes[name]) lessonNotes[name] = {};
        if (noteText) {
            lessonNotes[name][currentWeekNumber] = noteText;
        } else {
            delete lessonNotes[name][currentWeekNumber];
        }

    } else {
        const name = document.getElementById('edit-event-name').value.trim();
        const location = document.getElementById('edit-event-location').value.trim();
        const eventTier = document.querySelector('input[name="event-tier"]:checked').value;

        lessonObj = {
            ...lessonObj,
            name,
            location,
            eventTier,
            isEvent: true
        };
    }

    if (!scheduleData[currentDay]) scheduleData[currentDay] = [];

    if (editingLessonIndex !== null) {
        scheduleData[currentDay][editingLessonIndex] = lessonObj;
    } else {
        scheduleData[currentDay].push(lessonObj);
    }

    saveLocalData();
    closeEditModal();
    renderTabs();
    renderSchedule();
    syncWithBackend();
});

// Smazání hodiny / akce
document.getElementById('btn-delete-lesson').addEventListener('click', () => {
    if (editingLessonIndex === null) return;
    if (confirm('Opravdu chcete tuto položku odstranit z rozvrhu?')) {
        scheduleData[currentDay].splice(editingLessonIndex, 1);
        saveLocalData();
        closeEditModal();
        renderTabs();
        renderSchedule();
        syncWithBackend();
    }
});

// Přepnutí omluvenky
document.getElementById('btn-toggle-absent').addEventListener('click', () => {
    if (editingLessonIndex === null) return;
    const lesson = scheduleData[currentDay][editingLessonIndex];
    if (lesson.isEvent) return;

    const override = getOrCreateOverride(lesson.name);
    override.isAbsent = !override.isAbsent;

    saveLocalData();
    closeEditModal();
    renderTabs();
    renderSchedule();
    syncWithBackend();
});

// Zrušení zástupu
document.getElementById('btn-clear-substitute').addEventListener('click', () => {
    document.getElementById('substitute-select').value = '';
    document.getElementById('substitute-manual').value = '';
});

// Omluvenka na rozsah dat z kalendáře
document.getElementById('btn-absence').addEventListener('click', () => {
    const sel = document.getElementById('absence-student-select');
    sel.innerHTML = '';

    const allStudents = [];
    workDays.forEach(d => {
        (scheduleData[d] || []).forEach(l => {
            if (!l.isEvent && l.name && !allStudents.includes(l.name)) {
                allStudents.push(l.name);
            }
        });
    });
    allStudents.sort();

    allStudents.forEach(st => {
        const opt = document.createElement('option');
        opt.value = st;
        opt.textContent = st;
        sel.appendChild(opt);
    });

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    document.getElementById('absence-date-from').value = todayStr;
    document.getElementById('absence-date-to').value = todayStr;
    document.getElementById('absence-reason').value = '';

    document.getElementById('absence-range-modal').classList.remove('hidden');
});

document.getElementById('btn-absence-cancel').addEventListener('click', () => {
    document.getElementById('absence-range-modal').classList.add('hidden');
});

document.getElementById('absence-range-form').addEventListener('submit', e => {
    e.preventDefault();
    const student = document.getElementById('absence-student-select').value;
    const dateFrom = new Date(document.getElementById('absence-date-from').value);
    const dateTo = new Date(document.getElementById('absence-date-to').value);

    if (dateTo < dateFrom) {
        alert('Datum "Do" nesmí být dříve než datum "Od".');
        return;
    }

    const startWeek = getSchoolWeekNumber(dateFrom);
    const endWeek = getSchoolWeekNumber(dateTo);

    for (let w = startWeek; w <= endWeek; w++) {
        if (!weeklyExceptions[w]) weeklyExceptions[w] = {};
        if (!weeklyExceptions[w][student]) weeklyExceptions[w][student] = {};
        weeklyExceptions[w][student].isAbsent = true;
    }

    saveLocalData();
    document.getElementById('absence-range-modal').classList.add('hidden');
    renderTabs();
    renderSchedule();
    syncWithBackend();
    alert(`Omluvenka pro žáka ${student} byla zapsána na týdny ${startWeek} až ${endWeek}.`);
});

// Event listenery navigace a gest
function setupEventListeners() {
    document.getElementById('btn-prev-week').addEventListener('click', () => {
        if (currentWeekNumber > 1) {
            currentWeekNumber--;
            renderTabs();
            renderSchedule();
        }
    });

    document.getElementById('btn-next-week').addEventListener('click', () => {
        currentWeekNumber++;
        renderTabs();
        renderSchedule();
    });

    document.getElementById('btn-today').addEventListener('click', () => {
        determineInitialWeekAndDay();
        renderTabs();
        renderSchedule();
    });

    document.getElementById('btn-sync').addEventListener('click', () => {
        syncWithBackend(true);
    });

    document.getElementById('btn-add-lesson').addEventListener('click', () => {
        openEditModal(null);
    });

    document.getElementById('btn-swap-mode').addEventListener('click', () => {
        if (swapSourceStudent === null) {
            startSwapMode();
        } else {
            cancelSwapMode();
        }
    });

    document.getElementById('btn-modal-cancel').addEventListener('click', closeEditModal);

    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => setModalType(btn.dataset.type));
    });

    document.getElementById('edit-is-ensemble').addEventListener('change', e => {
        document.getElementById('ensemble-tier-container').classList.toggle('hidden', !e.target.checked);
    });

    const weekDisplay = document.getElementById('week-display-trigger');
    const datePicker = document.getElementById('native-date-picker');
    weekDisplay.addEventListener('click', () => {
        if (datePicker.showPicker) {
            datePicker.showPicker();
        } else {
            datePicker.focus();
        }
    });

    datePicker.addEventListener('change', e => {
        if (!e.target.value) return;
        const selDate = new Date(e.target.value);
        currentWeekNumber = getSchoolWeekNumber(selDate);
        const dayIdx = (selDate.getDay() || 7) - 1;
        if (dayIdx >= 0 && dayIdx <= 4) {
            currentDay = workDays[dayIdx];
        }
        renderTabs();
        renderSchedule();
    });

    // Plynulé swipe gesto pro přepínání dnů s haptikou
    document.addEventListener('touchstart', e => {
        touchStartX = e.touches[0].screenX;
    }, { passive: true });

    document.addEventListener('touchend', e => {
        if (!document.getElementById('edit-modal').classList.contains('hidden') ||
            !document.getElementById('absence-range-modal').classList.contains('hidden')) {
            return;
        }

        touchEndX = e.changedTouches[0].screenX;
        const idx = workDays.indexOf(currentDay);
        if (idx === -1) return;

        const swipeDist = touchEndX - touchStartX;
        const threshold = 45;

        if (swipeDist < -threshold && idx < workDays.length - 1) {
            currentDay = workDays[idx + 1];
            if (navigator.vibrate) navigator.vibrate(18);
            renderTabs();
            renderSchedule('right');
        } else if (swipeDist > threshold && idx > 0) {
            currentDay = workDays[idx - 1];
            if (navigator.vibrate) navigator.vibrate(18);
            renderTabs();
            renderSchedule('left');
        }
    }, { passive: true });
}

// Průběžná aktualizace stavu probíhající hodiny
function updateLessonProgress() {
    const now = new Date();
    const realWeek = getSchoolWeekNumber(now);
    const realDayIdx = (now.getDay() || 7) - 1;

    if (currentWeekNumber !== realWeek || realDayIdx < 0 || realDayIdx > 4 || workDays[realDayIdx] !== currentDay) {
        return;
    }

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const cards = document.querySelectorAll('.lesson-card');
    const lessons = scheduleData[currentDay] || [];

    lessons.forEach((l, idx) => {
        const start = timeToMinutes(l.time);
        const dur = parseInt(l.duration || 45, 10);
        const end = start + dur;
        const card = cards[idx];
        if (!card) return;

        if (nowMinutes >= start && nowMinutes <= end) {
            const pct = Math.min(100, Math.max(0, Math.round(((nowMinutes - start) / dur) * 100)));
            card.classList.add('current-lesson');
            card.style.opacity = (1 - (pct / 100) * 0.45).toFixed(2);
            let bar = card.querySelector('.lesson-progress-bar');
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'lesson-progress-bar';
                card.appendChild(bar);
            }
            bar.style.width = `${pct}%`;
        } else if (nowMinutes > end) {
            card.classList.remove('current-lesson');
            card.classList.add('past-lesson');
            card.style.opacity = '0.45';
            const bar = card.querySelector('.lesson-progress-bar');
            if (bar) bar.remove();
        }
    });
}

// Synchronizace s Google Apps Script backendem
async function syncWithBackend(showToast = false) {
    if (!CONFIG.GAS_URL) {
        if (showToast) alert('Chybí URL adresa backendu.');
        return;
    }

    const syncBtn = document.getElementById('btn-sync');
    if (syncBtn) syncBtn.style.transform = 'rotate(180deg)';

    try {
        const payload = {
            action: 'syncAll',
            schedule: scheduleData,
            exceptions: weeklyExceptions,
            notes: lessonNotes
        };

        const response = await fetch(CONFIG.GAS_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload)
        });

        const res = await response.json();

        if (res && res.status === 'success') {
            if (res.data) {
                if (res.data.schedule) scheduleData = res.data.schedule;
                if (res.data.exceptions) weeklyExceptions = res.data.exceptions;
                if (res.data.notes) lessonNotes = res.data.notes;
                saveLocalData();
                renderTabs();
                renderSchedule();
            }
            if (showToast) alert('Synchronizace s Google Tabulkou proběhla úspěšně.');
        } else {
            throw new Error(res.message || 'Chyba serveru');
        }

    } catch (err) {
        console.warn('Backend sync warning:', err);
        if (showToast) alert(`Synchronizace selhala: ${err.message}. Aplikace funguje spolehlivě offline.`);
    } finally {
        if (syncBtn) syncBtn.style.transform = 'rotate(0deg)';
    }
}

// Pomocné funkce pro manipulaci s daty
function getWeeklyOverride(studentName) {
    if (!studentName) return null;
    return (weeklyExceptions[currentWeekNumber] && weeklyExceptions[currentWeekNumber][studentName]) || null;
}

function getOrCreateOverride(studentName) {
    if (!weeklyExceptions[currentWeekNumber]) weeklyExceptions[currentWeekNumber] = {};
    if (!weeklyExceptions[currentWeekNumber][studentName]) weeklyExceptions[currentWeekNumber][studentName] = {};
    return weeklyExceptions[currentWeekNumber][studentName];
}

function findStudentSlot(studentName) {
    for (const d of workDays) {
        const list = scheduleData[d] || [];
        const idx = list.findIndex(l => l.name === studentName);
        if (idx !== -1) return { day: d, index: idx };
    }
    return null;
}

function getGenderClass(name) {
    if (!name) return '';
    for (const d of workDays) {
        const item = (scheduleData[d] || []).find(l => l.name === name);
        if (item && item.gender) {
            return (item.gender === 'divka') ? 'gender-girl' : 'gender-boy';
        }
    }
    return '';
}

function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(':').map(Number);
    return parts[0] * 60 + parts[1];
}

function minutesToTime(mins) {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}