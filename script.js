const GOOGLE_APP_URL = "https://script.google.com/macros/s/AKfycbzbn-loEtgL8Q96wbLrqR9Jluff6YSdmnVxnjnmULq0OMTAsFgjAaEjn77hw66aqjel/exec"

const defaultSchedule = {
  "Pondělí": [
    { "time": "13:45", "name": "Maxík Král", "rocnik": "2", "hn": "Po 14:30" },
    { "time": "14:30", "name": "David Kolář", "rocnik": "1", "hn": "Po 13:30" },
    { "time": "15:15", "name": "Vašík Brabec", "rocnik": "2", "hn": "Po 14:30" },
    { "time": "16:15", "name": "Kryštof Kott", "rocnik": "3", "hn": "Po 15:30" },
    { "time": "17:00", "name": "Váša Kováč", "rocnik": "7", "hn": "" }
  ],
  "Úterý": [
    { "time": "13:30", "name": "Ondra Holub", "rocnik": "2", "hn": "St 13:30" },
    { "time": "14:15", "name": "Tonda Martínek", "rocnik": "1", "hn": "Út 15:00" },
    { "time": "15:15", "name": "Jeník Burda", "rocnik": "3", "hn": "Út 16:00" },
    { "time": "16:00", "name": "Kryštof Stárek", "rocnik": "2", "hn": "St 13:30" },
    { "time": "16:50", "name": "Natálka Komárková", "rocnik": "6", "hn": "" }
  ],
  "Středa": [
    { "time": "13:00", "name": "Ema Hrstková", "rocnik": "2. př", "hn": "St 14:30" },
    { "time": "13:45", "name": "Ellen Borčová", "rocnik": "2. př", "hn": "St 14:30" },
    { "time": "14:30", "name": "Matyáš Dvořák", "rocnik": "2", "hn": "Po 14:30" },
    { "time": "15:20", "name": "Vojta Kvasnička", "rocnik": "6", "hn": "" },
    { "time": "16:05", "name": "Vašík Novotný", "rocnik": "5", "hn": "" }
  ],
  "Čtvrtek": [
    { "time": "13:20", "name": "Justýna Hrachovcová", "rocnik": "2", "hn": "St 13:30" },
    { "time": "14:05", "name": "Šimon Vrabec", "rocnik": "2", "hn": "St 13:30" },
    { "time": "14:55", "name": "Honza Andrýs", "rocnik": "5", "hn": "" },
    { "time": "15:45", "name": "Verča Bělohoubková", "rocnik": "5", "hn": "" },
    { "time": "16:30", "name": "Dominik Bělohoubek", "rocnik": "5", "hn": "" },
    { "time": "17:15", "name": "soukr. hodina", "rocnik": "", "hn": "" }
  ],
  "Pátek": [
    { "time": "13:15", "name": "František Sycha", "rocnik": "2. př", "hn": "" },
    { "time": "14:05", "name": "Kytarový soubor", "rocnik": "", "hn": "" },
    { "time": "14:50", "name": "Kytarový soubor", "rocnik": "", "hn": "" }
  ]
};

let schedule = JSON.parse(localStorage.getItem('zus_schedule')) || defaultSchedule;
let currentDay = '';
let swapSourceIndex = null;
let editingIndex = null;

const today = new Date().getDay();
const dayMap = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
currentDay = (today >= 1 && today <= 5) ? dayMap[today] : 'Pondělí';

function saveSchedule() {
    // 1. Okamžité uložení do mobilu (funguje i offline)
    localStorage.setItem('zus_schedule', JSON.stringify(schedule));
    
    // 2. Synchronizace do Google Tabulky na pozadí (pokud jsi online)
    fetch(GOOGLE_APP_URL, {
        method: 'POST',
        body: JSON.stringify(schedule)
        // Schválně nedáváme headers (Content-Type), aby se předešlo CORS chybě
    }).then(response => {
        console.log("Úspěšně uloženo do Google Sheets");
    }).catch(err => {
        console.error("Chyba synchronizace s Google Sheets (jste offline?)", err);
    });
}

function addMinutes(timeStr, mins) {
    if (!timeStr) return "00:00";
    let [h, m] = timeStr.split(':').map(Number);
    let date = new Date(2000, 0, 1, h, m + mins);
    return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
}

// --- NOVÁ FUNKCE PRO NAČTENÍ Z TABULKY ---
function loadFromGoogle() {
    // Načteme data z tabulky a pokud se liší, aktualizujeme rozvrh
    fetch(GOOGLE_APP_URL)
        .then(response => response.json())
        .then(data => {
            // Zkontrolujeme, zda tabulka není prázdná
            if (data["Pondělí"] && (data["Pondělí"].length > 0 || data["Úterý"].length > 0)) {
                schedule = data;
                localStorage.setItem('zus_schedule', JSON.stringify(schedule));
                renderSchedule();
                console.log("Rozvrh byl aktualizován z Google Sheets");
            } else if (schedule["Pondělí"].length > 0) {
                // Pokud je tabulka prázdná, ale my máme data, pošleme je do tabulky
                saveSchedule();
            }
        })
        .catch(err => console.log("Nelze načíst data z Google Sheets, používám lokální.", err));
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
        
        // Kliknutí na kartu
        card.onclick = () => handleCardClick(index);
        container.appendChild(card);
    });
}

// Logika kliknutí na kartu
function handleCardClick(index) {
    // 1. Zpracování výměny
    if (swapSourceIndex !== null) {
        if (swapSourceIndex === index) {
            swapSourceIndex = null; // Zrušení výměny kliknutím na sebe
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
    
    // 2. Otevření detailu hodiny
    editingIndex = index;
    const lesson = schedule[currentDay][index];
    
    document.getElementById('edit-time').value = lesson.time;
    document.getElementById('edit-name').value = lesson.name;
    document.getElementById('edit-rocnik').value = lesson.rocnik;
    document.getElementById('edit-hn').value = lesson.hn;
    
    document.getElementById('edit-modal').classList.remove('hidden');
}

// Obsluha modálního okna
document.getElementById('btn-cancel').onclick = () => {
    document.getElementById('edit-modal').classList.add('hidden');
};

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

// --- ZMĚNĚNÝ KONEC SOUBORU ---
const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const metaThemeColor = document.getElementById('theme-color-meta');

function updateThemeColor() {
    if (darkModeMediaQuery.matches) {
        metaThemeColor.setAttribute('content', '#1e1e1e');
    } else {
        metaThemeColor.setAttribute('content', '#005bb5');
    }
}
darkModeMediaQuery.addEventListener('change', updateThemeColor);
updateThemeColor();

if (!schedule['Pondělí']) schedule['Pondělí'] = [];
renderTabs();
renderSchedule();

// Pokusíme se synchronizovat aktuální stav z Google tabulky hned po spuštění
loadFromGoogle();