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

const today = new Date().getDay();
const dayMap = ['Neděle', 'Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota'];
currentDay = (today >= 1 && today <= 5) ? dayMap[today] : 'Pondělí';

function saveSchedule() {
    localStorage.setItem('zus_schedule', JSON.stringify(schedule));
}

function addMinutes(timeStr, mins) {
    if (!timeStr) return "00:00";
    let [h, m] = timeStr.split(':').map(Number);
    let date = new Date(2000, 0, 1, h, m + mins);
    return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
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
                <div class="student-name" contenteditable="true" onblur="updateField(${index}, 'name', this.innerText)">${lesson.name}</div>
                <div class="student-details">
                    Roč: <span contenteditable="true" onblur="updateField(${index}, 'rocnik', this.innerText)">${lesson.rocnik || '-'}</span> | 
                    HN: <span contenteditable="true" onblur="updateField(${index}, 'hn', this.innerText)">${lesson.hn || '-'}</span>
                </div>
            </div>
            <div class="actions-col">
                <button class="btn-swap ${swapSourceIndex === index ? 'active' : ''}" onclick="toggleSwap(${index})" title="Vyměnit">🔄</button>
                <button onclick="deleteLesson(${index})" title="Smazat">❌</button>
            </div>
        `;
        container.appendChild(card);
    });
}

window.updateField = function(index, field, value) {
    schedule[currentDay][index][field] = value.trim();
    saveSchedule();
}

window.toggleSwap = function(index) {
    if (swapSourceIndex === index) {
        swapSourceIndex = null;
    } else if (swapSourceIndex !== null) {
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
    } else {
        swapSourceIndex = index;
    }
    renderSchedule();
}

window.deleteLesson = function(index) {
    if (confirm('Opravdu chcete tuto hodinu smazat?')) {
        schedule[currentDay].splice(index, 1);
        saveSchedule();
        renderSchedule();
    }
}

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

    dayData.push({
        time: timeInput,
        name: nameInput || "Nový žák",
        rocnik: "",
        hn: ""
    });
    
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

    const dayData = schedule[currentDay];
    
    dayData.forEach(lesson => {
        if (lesson.time >= targetTime) {
            lesson.time = addMinutes(lesson.time, mins);
        }
    });
    
    saveSchedule();
    renderSchedule();
};

// DYNAMICKÁ BARVA SYSTÉMOVÉ LIŠTY (STATUS BAR)
const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
const metaThemeColor = document.getElementById('theme-color-meta');

function updateThemeColor() {
    if (darkModeMediaQuery.matches) {
        // V tmavém režimu má hlavička barvu #1e1e1e (tmavě šedá)
        metaThemeColor.setAttribute('content', '#1e1e1e');
    } else {
        // Ve světlém režimu má hlavička barvu #005bb5 (primární modrá)
        metaThemeColor.setAttribute('content', '#005bb5');
    }
}
darkModeMediaQuery.addEventListener('change', updateThemeColor);
updateThemeColor(); // Spustit hned při načtení

if (!schedule['Pondělí']) schedule['Pondělí'] = [];
renderTabs();
renderSchedule();