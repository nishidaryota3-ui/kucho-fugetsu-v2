const SPREADSHEET_ID = '1m0y8AOJNx1Ad4I44poPheQAQNki1-QQIwi9wSw8jaBg';
const SAIJIKI_SPREADSHEET_ID = '1EOmZn53hFA8GpVdcn--aU-lj9uHjGQpnSZ1o9jbnsYs';
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwgm4eh8qZGRxvFS8_b8iEJAC9vRGw31gOvjgsPQMPc1ymU4oKonErvUkL0Ucf6xnZO/exec';

let saijikiDatabase = []; 
let authorDatabase = [];  
let haikuHistory = [];    

let currentReadTab = '完成句'; 
let editingHaikuObj = null; 
let activeSelectedHaiku = null; 

let omikujiPool = [];
let omikujiIndex = 0;
let touchStartX = 0;
let touchStartY = 0;

let currentHaikuData = {
    phrase: '', oldPhrase: '', kigo: '', parentKigo: '', parentKana: '',
    season: 'haru', detailSeason: '', author: '西田上酢', authorKana: 'にしだうえす',
    sakkuDate: '', status: '完成句'
};

function getTodayDateString() {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function toKanjiNum(str) {
    const numMap = {'0':'〇', '1':'一', '2':'二', '3':'三', '4':'四', '5':'五', '6':'六', '7':'七', '8':'八', '9':'九'};
    return String(str).split('').map(char => numMap[char] || char).join('');
}

function parseDateLabel(dateStr) {
    if (!dateStr) return { groupKey: '0000-00', exactKey: '0000-00-00', label: '過去作品' };
    let str = String(dateStr).trim();
    if (str.includes('Date(')) {
        const m = str.match(/\d+/g);
        if (m && m.length >= 3) str = `${m[0]}-${parseInt(m[1])+1}-${m[2]}`;
    }
    str = str.replace(/[/.]/g, '-');
    const parts = str.split('-').map(p => p.trim()).filter(Boolean);

    if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
        return { groupKey: `${parts[0]}-00`, exactKey: `${parts[0]}-00-00`, label: `${toKanjiNum(parts[0])}年` };
    }
    if (parts.length >= 2 && /^\d{4}$/.test(parts[0])) {
        const y = parts[0], mNum = parseInt(parts[1], 10);
        if (!isNaN(mNum)) {
            const monthMap = {1:'一', 2:'二', 3:'三', 4:'四', 5:'五', 6:'六', 7:'七', 8:'八', 9:'九', 10:'十', 11:'十一', 12:'十二'};
            return { groupKey: `${y}-${String(mNum).padStart(2, '0')}`, exactKey: `${y}-${String(mNum).padStart(2, '0')}-${parts[2] ? String(parseInt(parts[2], 10)).padStart(2, '0') : '00'}`, label: `${toKanjiNum(y)}年 ${monthMap[mNum] || mNum}月` };
        }
    }
    return { groupKey: '0000-00', exactKey: '0000-00-00', label: '過去作品' };
}

window.onload = function() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
    const todayInput = document.getElementById('sakkuDateInput');
    if (todayInput) todayInput.value = getTodayDateString();

    restoreCachedMasterData();
    fetchMainHaikuData();
    fetchSaijikiMasterData();
    initSwipeEvents();
    initKeyboardEvents();
    window.addEventListener('online', processOfflineQueue);
    processOfflineQueue();
};

function restoreCachedMasterData() {
    try {
        const cachedSaijiki = localStorage.getItem('hugetsu_saijiki_db');
        if (cachedSaijiki) saijikiDatabase = JSON.parse(cachedSaijiki);
    } catch (e) {}
}

function fetchMainHaikuData() {
    const oldScript = document.getElementById('mainHaikuScript');
    if (oldScript) oldScript.remove();
    const script = document.createElement('script');
    script.id = 'mainHaikuScript';
    script.src = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=responseHandler:mainDataReceived&_=${new Date().getTime()}`;
    document.body.appendChild(script);
}

window.mainDataReceived = function(data) {
    try {
        if (!data || !data.table || !data.table.rows) return;
        haikuHistory = [];
        let authorMap = {};
        const rows = data.table.rows;

        for (let i = 0; i < rows.length; i++) {
            const c = rows[i].c;
            if (!c) continue;
            const getVal = (idx) => {
                if (!c[idx]) return '';
                let val = (c[idx].f !== null && c[idx].f !== undefined) ? c[idx].f : c[idx].v;
                return (val !== null && val !== undefined) ? String(val).trim() : '';
            };
            
            const phrase = getVal(0);
            if (!phrase || phrase === '俳句' || phrase === '句' || phrase === 'A') continue;

            const author = getVal(1);
            const authorKana = getVal(2) || 'にしだうえす';
            
            const isMyAuthor = (!author || author === '西田上酢' || author === '西田亮太' || author === 'UES');
            if (!isMyAuthor) continue;

            const displayAuthor = author || '西田上酢';
            haikuHistory.push({
                phrase, author: displayAuthor, authorKana,
                kigo: getVal(3), parentKigo: getVal(4),
                season: getVal(6), detailSeason: getVal(7),
                status: getVal(10) || '完成句', sakkuDate: getVal(11)
            });

            if (displayAuthor && displayAuthor !== '作者名') {
                authorMap[displayAuthor] = authorKana || displayAuthor;
            }
        }

        authorDatabase = Object.keys(authorMap).map(name => ({ name, kana: authorMap[name] }));
        updateAuthorDatalist();

        if (document.getElementById('readScreen').classList.contains('active')) renderYomuList();
    } catch (e) { console.error(e); }
};

function fetchSaijikiMasterData() {
    const script = document.createElement('script');
    script.src = `https://docs.google.com/spreadsheets/d/${SAIJIKI_SPREADSHEET_ID}/gviz/tq?sheet=${encodeURIComponent('歳時記データベース')}&range=A:F&tqx=responseHandler:saijikiDataReceived`;
    document.body.appendChild(script);
}

window.saijikiDataReceived = function(data) {
    try {
        if (!data || !data.table || !data.table.rows) return;
        let kigoList = [];
        data.table.rows.forEach(row => {
            const c = row.c;
            if (!c) return;
            const getVal = (idx) => (c[idx] && c[idx].v !== null) ? String(c[idx].v).trim() : '';
            const parentKigo = getVal(2), childKigo = getVal(4);
            if (childKigo && childKigo !== '子季語') kigoList.push({ kigo: childKigo, parentKigo: parentKigo || childKigo, parentKana: getVal(3), season: parseSeasonCode(getVal(0)), detailSeason: getVal(1) });
            if (parentKigo && parentKigo !== '親季語') kigoList.push({ kigo: parentKigo, parentKigo: parentKigo, parentKana: getVal(3), season: parseSeasonCode(getVal(0)), detailSeason: getVal(1) });
        });
        let uniqueMap = {};
        kigoList.forEach(item => { if (!uniqueMap[item.kigo]) uniqueMap[item.kigo] = item; });
        saijikiDatabase = Object.values(uniqueMap);
        localStorage.setItem('hugetsu_saijiki_db', JSON.stringify(saijikiDatabase));
    } catch (e) {}
};

function parseSeasonCode(str) {
    if (!str) return 'haru';
    const s = str.toLowerCase().trim();
    if (s.includes('natsu') || s === '夏') return 'natsu';
    if (s.includes('aki') || s === '秋') return 'aki';
    if (s.includes('fuyu') || s.includes('huyu') || s === '冬') return 'fuyu';
    if (s.includes('shinnen') || s === '新年') return 'shinnen';
    if (s.includes('muki') || s === '無季') return 'muki';
    return 'haru';
}

function updateAuthorDatalist() {
    const authorListEl = document.getElementById('authorList');
    if (!authorListEl) return;
    authorListEl.innerHTML = '';
    authorDatabase.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.kana ? `${item.name}（${item.kana}）` : item.name;
        authorListEl.appendChild(opt);
    });
}

function updateCatVisibility(show) {
    const cat = document.getElementById('fixedCatBtn');
    if (cat) cat.classList.toggle('hidden', !show);
}

function goToStartScreen() {
    updateCatVisibility(false);
    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    document.getElementById('startScreen').classList.add('active');
}

function startEmuMode() {
    updateCatVisibility(false);
    editingHaikuObj = null;
    currentHaikuData.oldPhrase = ''; 
    document.getElementById('inputPhrase').value = '';
    document.getElementById('authorInput').value = '西田上酢';
    document.getElementById('authorKanaInput').value = 'にしだうえす';
    goToStep(1);
    const input = document.getElementById('inputPhrase');
    if (input) input.focus();
}

function cancelEmuMode() {
    if (editingHaikuObj) startYomuMode(); else goToStartScreen();
}

function startYomuMode() {
    fetchMainHaikuData();
    renderYomuList();
    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    document.getElementById('readScreen').classList.add('active');
    updateCatVisibility(true);
}

function switchReadTab(status) {
    currentReadTab = status;
    document.getElementById('tabKansei').classList.toggle('active', status === '完成句');
    document.getElementById('tabShitagaki').classList.toggle('active', status === '下書き');
    renderYomuList();
}

function expandSearchInput() {
    const wrapper = document.getElementById('searchWrapper');
    const input = document.getElementById('kigoFilterInput');
    if (wrapper && input) { wrapper.classList.add('expanded'); input.focus(); }
}

function collapseSearchIfEmpty() {
    const wrapper = document.getElementById('searchWrapper');
    const input = document.getElementById('kigoFilterInput');
    if (wrapper && input && input.value.trim() === '') wrapper.classList.remove('expanded');
}

function onKigoFilterInputChanged() {
    const clearBtn = document.getElementById('clearKigoFilterBtn');
    if (clearBtn) clearBtn.classList.toggle('hidden', document.getElementById('kigoFilterInput').value.trim() === '');
    renderYomuList();
}

function clearKigoFilter(event) {
    if (event) event.stopPropagation();
    const input = document.getElementById('kigoFilterInput');
    if (input) input.value = '';
    const clearBtn = document.getElementById('clearKigoFilterBtn');
    if (clearBtn) clearBtn.classList.add('hidden');
    collapseSearchIfEmpty();
    renderYomuList();
}

/* 🔄 完全に修正された並び替え処理（左が古い ➔ 右が新しい） */
function renderYomuList() {
    const container = document.getElementById('readHaikuList');
    if (!container) return;
    container.innerHTML = '';

    const filterQuery = document.getElementById('kigoFilterInput') ? document.getElementById('kigoFilterInput').value.trim().toLowerCase() : '';

    const targetHaikus = haikuHistory.filter(h => {
        if (h.status !== currentReadTab) return false;
        if (filterQuery !== '') return ((h.parentKigo || '') + ' ' + (h.kigo || '')).toLowerCase().includes(filterQuery);
        return true;
    });

    if (targetHaikus.length === 0) {
        container.innerHTML = `<div style="text-align:center; color:#888; margin:auto; font-size:0.9rem;">該当する${currentReadTab}はありません。</div>`;
        return;
    }

    targetHaikus.forEach(item => item._parsedDate = parseDateLabel(item.sakkuDate));

    /* 新しい日付を配列の先頭にする（降順ソート）➔ これにより画面右端に最新句が配置されます */
    targetHaikus.sort((a, b) => {
        if (a._parsedDate.groupKey !== b._parsedDate.groupKey) {
            return b._parsedDate.groupKey.localeCompare(a._parsedDate.groupKey); 
        }
        return b._parsedDate.exactKey.localeCompare(a._parsedDate.exactKey); 
    });

    let lastGroupKey = '';
    targetHaikus.forEach(item => {
        if (item._parsedDate.groupKey !== lastGroupKey) {
            lastGroupKey = item._parsedDate.groupKey;
            const divider = document.createElement('div');
            divider.className = 'date-divider-card';
            divider.innerText = item._parsedDate.label;
            container.appendChild(divider);
        }
        const card = document.createElement('div');
        card.className = 'saijiki-haiku-card';
        card.onclick = () => onHaikuCardClicked(item);
        card.innerHTML = `<div class="saijiki-phrase">${item.phrase}</div>`;
        container.appendChild(card);
    });

    requestAnimationFrame(() => { container.scrollLeft = container.scrollWidth; });
}

function onHaikuCardClicked(haikuObj) {
    activeSelectedHaiku = haikuObj;
    document.getElementById('modalPhrase').innerText = haikuObj.phrase;
    const actionsContainer = document.getElementById('modalActions');

    if (haikuObj.status === '完成句') {
        actionsContainer.innerHTML = `
            <span class="text-action-btn primary" onclick="editSelectedHaiku()">修正</span>
            <span class="action-divider">|</span>
            <span class="text-action-btn" onclick="changeHaikuStatus('下書き')">下書きへ</span>
        `;
    } else {
        actionsContainer.innerHTML = `
            <span class="text-action-btn primary" onclick="changeHaikuStatus('完成句')">完成句へ</span>
            <span class="action-divider">|</span>
            <span class="text-action-btn" onclick="editSelectedHaiku()">修正</span>
            <span class="action-divider">|</span>
            <span class="text-action-btn danger" onclick="deleteSelectedDraft()">削除</span>
        `;
    }
    document.getElementById('haikuDetailModal').classList.remove('hidden');
}

function closeHaikuDetailModal() { document.getElementById('haikuDetailModal').classList.add('hidden'); }

/* 確実なステータス変更（oldPhraseを送信） */
function changeHaikuStatus(targetStatus) {
    if (!activeSelectedHaiku) return;
    closeHaikuDetailModal();

    const formData = new URLSearchParams();
    formData.append('action', 'changeStatus');
    formData.append('status', targetStatus);
    formData.append('oldPhrase', activeSelectedHaiku.phrase);

    fetch(GAS_WEB_APP_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData.toString() })
    .then(() => setTimeout(fetchMainHaikuData, 1000)).catch(() => setTimeout(fetchMainHaikuData, 1000));
}

/* 確実な削除（oldPhraseを送信） */
function deleteSelectedDraft() {
    if (!activeSelectedHaiku) return;
    if (!confirm('本当に削除しますか？\n（句帳から完全に消去されます）')) return;
    closeHaikuDetailModal();

    const formData = new URLSearchParams();
    formData.append('action', 'delete');
    formData.append('oldPhrase', activeSelectedHaiku.phrase);

    fetch(GAS_WEB_APP_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData.toString() })
    .then(() => setTimeout(fetchMainHaikuData, 1000)).catch(() => setTimeout(fetchMainHaikuData, 1000));
}

function triggerRandomOmikuji() {
    omikujiPool = haikuHistory.filter(h => h.status === '完成句');
    if (omikujiPool.length === 0) { alert('鑑賞できる句がありません。'); return; }
    for (let i = omikujiPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [omikujiPool[i], omikujiPool[j]] = [omikujiPool[j], omikujiPool[i]];
    }
    omikujiIndex = 0; renderOmikujiDisplay();
    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    document.getElementById('omikujiRoomScreen').classList.add('active');
    updateCatVisibility(true);
}

function changeOmikujiHaiku(direction) {
    if (omikujiIndex + direction >= 0 && omikujiIndex + direction < omikujiPool.length) {
        omikujiIndex += direction; renderOmikujiDisplay();
    }
}

function renderOmikujiDisplay() {
    document.getElementById('omikujiPhrase').innerText = omikujiPool[omikujiIndex].phrase;
    document.getElementById('prevBtn').classList.toggle('disabled', omikujiIndex === 0);
    document.getElementById('nextBtn').classList.toggle('disabled', omikujiIndex === omikujiPool.length - 1);
}

function initKeyboardEvents() {
    document.addEventListener('keydown', function(e) {
        const room = document.getElementById('omikujiRoomScreen');
        if (!room || !room.classList.contains('active') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') changeOmikujiHaiku(-1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') changeOmikujiHaiku(1);
    });
}

function initSwipeEvents() {
    const room = document.getElementById('omikujiRoomScreen');
    if (!room) return;
    room.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }, { passive: true });
    room.addEventListener('touchend', e => {
        const diffX = e.changedTouches[0].clientX - touchStartX;
        if (Math.abs(diffX) > 35 && Math.abs(diffX) > Math.abs(e.changedTouches[0].clientY - touchStartY)) changeOmikujiHaiku(diffX > 0 ? 1 : -1);
    }, { passive: true });
}

function editSelectedHaiku() {
    closeHaikuDetailModal();
    if (!activeSelectedHaiku) return;

    editingHaikuObj = activeSelectedHaiku;
    currentHaikuData.oldPhrase = activeSelectedHaiku.phrase; // ここで元テキストを保存！
    
    document.getElementById('inputPhrase').value = activeSelectedHaiku.phrase;
    document.getElementById('kigoInput').value = activeSelectedHaiku.parentKigo || activeSelectedHaiku.kigo || '';
    if (activeSelectedHaiku.season) document.getElementById('seasonSelect').value = activeSelectedHaiku.season;
    if (activeSelectedHaiku.detailSeason) document.getElementById('detailSeasonSelect').value = activeSelectedHaiku.detailSeason;
    document.getElementById('authorInput').value = activeSelectedHaiku.author || '西田上酢';
    document.getElementById('authorKanaInput').value = activeSelectedHaiku.authorKana || 'にしだうえす';
    if (activeSelectedHaiku.sakkuDate) document.getElementById('sakkuDateInput').value = activeSelectedHaiku.sakkuDate;

    goToStep(1);
}

function goToStep(stepNumber) {
    updateCatVisibility(false);
    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    document.getElementById(`step${stepNumber}`).classList.add('active');
}

function goToStep2() {
    const phraseInput = document.getElementById('inputPhrase').value.trim();
    if (!phraseInput) { alert('句を入力してください。'); return; }
    currentHaikuData.phrase = phraseInput;
    detectKigo(phraseInput);
    goToStep(2);
}

function detectKigo(phrase) {
    let detected = null;
    const cleanPhrase = phrase.replace(/\s+/g, '');
    if (saijikiDatabase && saijikiDatabase.length > 0) {
        let sorted = [...saijikiDatabase].sort((a, b) => b.kigo.length - a.kigo.length);
        detected = sorted.find(item => cleanPhrase.includes(item.kigo));
    }
    const promptEl = document.getElementById('detectedKigoText');
    if (detected) {
        if (promptEl) promptEl.innerText = `${detected.kigo}`;
        document.getElementById('kigoInput').value = detected.parentKigo;
        document.getElementById('seasonSelect').value = detected.season || 'huyu';
        if (document.getElementById('detailSeasonSelect')) document.getElementById('detailSeasonSelect').value = detected.detailSeason || '';
        currentHaikuData.kigo = detected.kigo; currentHaikuData.parentKigo = detected.parentKigo; currentHaikuData.parentKana = detected.parentKana || '';
    } else {
        if (promptEl) promptEl.innerText = '見つかりませんでした';
        document.getElementById('kigoInput').value = '';
    }
}

function checkAndHokanKigoData() {
    const val = document.getElementById('kigoInput').value.trim();
    if (!val) return;
    let hit = saijikiDatabase.find(item => item.kigo === val || item.parentKigo === val);
    if (hit) {
        if (hit.season) document.getElementById('seasonSelect').value = hit.season;
        if (hit.detailSeason) document.getElementById('detailSeasonSelect').value = hit.detailSeason;
        currentHaikuData.parentKana = hit.parentKana || '';
    }
}

function onAuthorNameChange() {
    let nameVal = document.getElementById('authorInput').value.trim();
    if (nameVal.includes('（')) {
        const parts = nameVal.split('（');
        document.getElementById('authorInput').value = parts[0];
        document.getElementById('authorKanaInput').value = parts[1].replace('）', '');
    }
}
function onAuthorInputChanged() { onAuthorNameChange(); }
function onAuthorKanaInputChanged() {}

function goToStep3() {
    const inputKigoVal = document.getElementById('kigoInput').value.trim();
    let hit = saijikiDatabase.find(item => item.kigo === inputKigoVal || item.parentKigo === inputKigoVal);
    currentHaikuData.parentKigo = inputKigoVal;
    currentHaikuData.kigo = (hit && hit.kigo !== hit.parentKigo) ? hit.kigo : inputKigoVal;
    currentHaikuData.season = document.getElementById('seasonSelect').value;
    currentHaikuData.detailSeason = document.getElementById('detailSeasonSelect').value;
    
    currentHaikuData.author = document.getElementById('authorInput').value.trim() || '西田上酢';
    currentHaikuData.authorKana = document.getElementById('authorKanaInput').value.trim() || 'にしだうえす';
    currentHaikuData.sakkuDate = document.getElementById('sakkuDateInput').value || getTodayDateString();

    document.getElementById('previewPhrase').innerText = currentHaikuData.phrase;
    document.getElementById('previewAuthor').innerText = currentHaikuData.author;
    let seasonJa = {'haru':'春', 'natsu':'夏', 'aki':'秋', 'huyu':'冬', 'shinnen':'新年', 'muki':'無季'}[currentHaikuData.season] || currentHaikuData.season;
    let detailSuffix = currentHaikuData.detailSeason ? `（${currentHaikuData.detailSeason}）` : '';
    document.getElementById('previewBreadcrumb').innerHTML = `<span>季寄せ</span> <span class="separator">&lt;</span> <span>${seasonJa}</span> <span class="separator">&lt;</span> <span>${currentHaikuData.parentKigo || '無季'}${detailSuffix}</span>`;
    goToStep(3);
}

function submitHaiku(statusType) {
    const formData = new URLSearchParams();
    formData.append('action', 'save');
    formData.append('phrase', currentHaikuData.phrase);
    formData.append('oldPhrase', currentHaikuData.oldPhrase || ''); // ここで元テキストを送信！
    formData.append('author', currentHaikuData.author);
    formData.append('authorKana', currentHaikuData.authorKana);
    formData.append('kigo', currentHaikuData.kigo || currentHaikuData.parentKigo);
    formData.append('parentKigo', currentHaikuData.parentKigo);
    formData.append('parentKana', currentHaikuData.parentKana);
    formData.append('season', currentHaikuData.season);
    formData.append('detailSeason', currentHaikuData.detailSeason);
    formData.append('status', statusType);
    formData.append('sakkuDate', currentHaikuData.sakkuDate);

    document.getElementById('completeTitle').innerText = `${statusType}として保存しました`;

    fetch(GAS_WEB_APP_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData.toString() })
    .then(() => { setTimeout(fetchMainHaikuData, 1000); goToStep(4); })
    .catch(() => { saveToOfflineQueue({ ...currentHaikuData, status: statusType }); goToStep(4); });
}

function finishAndReturn() {
    editingHaikuObj = null;
    currentHaikuData.oldPhrase = '';
    startYomuMode();
}

function saveToOfflineQueue(data) {
    let queue = [];
    try { const stored = localStorage.getItem('hugetsu_offline_queue'); if (stored) queue = JSON.parse(stored); } catch (e) {}
    queue.push(data);
    localStorage.setItem('hugetsu_offline_queue', JSON.stringify(queue));
}

function processOfflineQueue() {
    if (!navigator.onLine) return;
    try {
        const stored = localStorage.getItem('hugetsu_offline_queue');
        if (!stored) return;
        let queue = JSON.parse(stored);
        if (queue.length === 0) return;
        
        queue.forEach(item => {
            const formData = new URLSearchParams();
            for (let key in item) formData.append(key, item[key]);
            fetch(GAS_WEB_APP_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: formData.toString() });
        });
        localStorage.removeItem('hugetsu_offline_queue');
        setTimeout(fetchMainHaikuData, 1000);
    } catch (e) {}
}

function resetForm() {
    document.getElementById('inputPhrase').value = '';
    document.getElementById('kigoInput').value = '';
    currentHaikuData.oldPhrase = '';
    goToStep(1);
}
