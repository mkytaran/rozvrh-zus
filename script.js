const GOOGLE_APP_URL = "https://script.google.com/macros/s/AKfycbzbn-loEtgL8Q96wbLrqR9Jluff6YSdmnVxnjnmULq0OMTAsFgjAaEjn77hw66aqjel/exec"

// --- NOVÉ: Zjištění PINu z paměti telefonu ---
let appPin = localStorage.getItem('zus_pin');
if (!appPin) {
    appPin = prompt("Zadejte tajný PIN pro synchronizaci rozvrhu:");
    localStorage.setItem('zus_pin', appPin);
}

const defaultSchedule = {
  "Pondělí": [], "Úterý": [], "Středa": [], "Čtvrtek": [], "Pátek": []
};

let schedule = JSON.parse(localStorage.getItem('zus_schedule')) || defaultSchedule;
let currentDay = '';
let swapSourceIndex = null;
let editingIndex = null;

const today = new Date().getDay();
const dayMap = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
currentDay = (today >= 1 && today <= 5) ? dayMap[today] : 'Pondělí';

function saveSchedule() {
    localStorage.setItem('zus_schedule', JSON.stringify(schedule));
    fetch(GOOGLE_APP_URL + "?pin=" + appPin, {
        method: 'POST',
        body: JSON.stringify(schedule)
    }).then(response => {
        console.log("Úspěšně uloženo do Google Sheets");
    }).catch(err => {
        console.error("Chyba synchronizace s Google Sheets", err);
    });
}

function addMinutes(timeStr, mins) {
    if (!timeStr || typeof timeStr !== 'string' || !timeStr.includes(':')) return "00:00";
    let match = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (!match) return "00:00";
    let h = parseInt(match[1]);
    let m = parseInt(match[2]);
    if (isNaN(h) || isNaN(m)) return "00:00";
    let date = new Date(2000, 0, 1, h, m + mins);
    return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
}

function loadFromGoogle() {
    fetch(GOOGLE_APP_URL + "?pin=" + appPin)
        .then(response => {
            // Kontrola, jestli Google nevrátil chybu o špatném pinu
            if (response.status === 200) return response.text();
            throw new Error("Chyba spojení");
        })
        .then(text => {
            if (text.includes("Přístup odepřen")) {
                alert("Špatný PIN. Aplikace se nyní resetuje.");
                localStorage.removeItem('zus_pin');
                location.reload();
                return;
            }
            
            // Tady starý kód dělal neplechu. Nyní správně zpracujeme data:
            const data = JSON.parse(text);
            
            if (data["Pondělí"] && (data["Pondělí"].length > 0 || data["Úterý"].length > 0)) {
                schedule = data;
                localStorage.setItem('zus_schedule', JSON.stringify(schedule));
                renderSchedule();
            } else if (schedule["Pondělí"].length > 0) {
                saveSchedule();
            }
        })
        .catch(err => console.log("Nelze načíst data, používám lokální.", err));
}

function renderTabs() {
    document.querySelectorAll('.day-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.day === currentDay);
        btn.onclick = () => {
            currentDay = btn.dataset.day;
            swapSourceIndex = null;
            renderTabs();
            renderSchedule();
        };
    });
}

function renderSchedule() {
    const container = document.getElementById('schedule-container');
    container.innerHTML = '';
    
    let dayData = schedule[currentDay] || [];
    dayData.sort((a, b) => a.time.localeCompare(b.time));
    
    dayData.forEach((lesson, index) => {
        const endTime = addMinutes(lesson.time, 45);
        const card = document.createElement('div');
        card.className = `lesson-card ${swapSourceIndex === index ? 'swap-mode' : ''}`;
        
        card.innerHTML = `
            <div class="time-col">
                <div>${lesson.time}</div>
                <div class="end-time">${endTime}</div>
            </div>
            <div class="info-col">
                <div class="student-name">${lesson.name}</div>
                <div class="student-details">
                    Roč: <span>${lesson.rocnik || '-'}</span> | 
                    HN: <span>${lesson.hn || '-'}</span>
                </div>
            </div>
        `;
        
        card.onclick = () => handleCardClick(index);
        container.appendChild(card);
    });
}

function handleCardClick(index) {
    if (swapSourceIndex !== null) {
        if (swapSourceIndex === index) {
            swapSourceIndex = null; 
        } else {
            const dayData = schedule[currentDay];
            const tempName = dayData[index].name;
            const tempRocnik = dayData[index].rocnik;
            const tempHn = dayData[index].hn;
            
            dayData[index].name = dayData[swapSourceIndex].name;
            dayData[index].rocnik = dayData[swapSourceIndex].rocnik;
            dayData[index].hn = dayData[swapSourceIndex].hn;
            
            dayData[swapSourceIndex].name = tempName;
            dayData[swapSourceIndex].rocnik = tempRocnik;
            dayData[swapSourceIndex].hn = tempHn;
            
            swapSourceIndex = null;
            saveSchedule();
        }
        renderSchedule();
        return;
    }
    
    editingIndex = index;
    const lesson = schedule[currentDay][index];
    document.getElementById('edit-time').value = lesson.time;
    document.getElementById('edit-name').value = lesson.name;
    document.getElementById('edit-rocnik').value = lesson.rocnik;
    document.getElementById('edit-hn').value = lesson.hn;
    document.getElementById('edit-modal').classList.remove('hidden');
}

document.getElementById('btn-cancel').onclick = () => document.getElementById('edit-modal').classList.add('hidden');

document.getElementById('btn-save').onclick = () => {
    if (editingIndex !== null) {
        const dayData = schedule[currentDay];
        dayData[editingIndex].time = document.getElementById('edit-time').value;
        dayData[editingIndex].name = document.getElementById('edit-name').value.trim();
        dayData[editingIndex].rocnik = document.getElementById('edit-rocnik').value.trim();
        dayData[editingIndex].hn = document.getElementById('edit-hn').value.trim();
        saveSchedule();
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
        const lastLesson = dayData[dayData.length - 1];
        newTime = addMinutes(lastLesson.time, 45); 
    }
    let timeInput = prompt("Čas začátku nové hodiny (HH:MM):", newTime);
    if (!timeInput) return;
    let nameInput = prompt("Jméno žáka:");
    if (nameInput === null) return;

    dayData.push({ time: timeInput, name: nameInput || "Nový žák", rocnik: "", hn: "" });
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

// --- NOVÉ: Přecházení mezi dny tažením (Swipe) ---
let touchStartX = 0;
let touchEndX = 0;
const workDays = ['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek'];

document.addEventListener('touchstart', e => {
    // Nechceme reagovat na tahání, pokud je otevřené modální okno k úpravám
    if (!document.getElementById('edit-modal').classList.contains('hidden')) return;
    touchStartX = e.changedTouches[0].screenX;
}, {passive: true});

document.addEventListener('touchend', e => {
    if (!document.getElementById('edit-modal').classList.contains('hidden')) return;
    touchEndX = e.changedTouches[0].screenX;
    
    let currentIndex = workDays.indexOf(currentDay);
    if (currentIndex === -1) return;

    // Tah doleva (přechod na další den)
    if (touchEndX < touchStartX - 60) {
        if (currentIndex < workDays.length - 1) {
            currentDay = workDays[currentIndex + 1];
            swapSourceIndex = null;
            renderTabs();
            renderSchedule();
        }
    }
    // Tah doprava (přechod na předchozí den)
    if (touchEndX > touchStartX + 60) {
        if (currentIndex > 0) {
            currentDay = workDays[currentIndex - 1];
            swapSourceIndex = null;
            renderTabs();
            renderSchedule();
        }
    }
}, {passive: true});

// --- ZMĚNA: Barva systémové lišty podle pozadí aplikace ---
const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const metaThemeColor = document.getElementById('theme-color-meta');

function updateThemeColor() {
    if (darkModeMediaQuery.matches) {
        metaThemeColor.setAttribute('content', '#121212'); // Pozadí v tmavém režimu
    } else {
        metaThemeColor.setAttribute('content', '#f0f4f8'); // Pozadí ve světlém režimu
    }
}
darkModeMediaQuery.addEventListener('change', updateThemeColor);
updateThemeColor();

if (!schedule['Pondělí']) schedule['Pondělí'] = [];
renderTabs();
renderSchedule();
loadFromGoogle();