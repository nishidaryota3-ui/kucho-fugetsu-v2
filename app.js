// ① 「風月」自身のスプレッドシートID
const SPREADSHEET_ID = '1m0y8AOJNx1Ad4I44poPheQAQNki1-QQIwi9wSw8jaBg';

// ② 共通の「歳時記データベース」スプレッドシートID
const SAIJIKI_SPREADSHEET_ID = '1EOmZn53hFA8GpVdcn--aU-lj9uHjGQpnSZ1o9jbnsYs';

// Webアプリ（GAS）のURL
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
    phrase: '', kigo: '', parentKigo: '', parentKana: '',
    season: 'haru', detailSeason: '', author: '西田上酢', authorKana: 'にしだうえす',
    sakkuDate: '', status: '完成句', rowIndex: 0
};

function getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
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
        if (m && m.length >= 3) {
            str = `${m[0]}-${parseInt(m[1])+1}-${m[2]}`;
        }
    }

    str = str.replace(/[/.]/g, '-');
    const parts = str.split('-').map(p => p.trim()).filter(Boolean);

    if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
        const y = parts[0];
        return { groupKey: `${y}-00`, exactKey: `${y}-00-00`, label: `${toKanjiNum(y)}年` };
    }

    if (parts.length >= 2 && /^\d{4}$/.test(parts[0])) {
        const y = parts[0];
        const mNum = parseInt(parts[1], 10);
        if (!isNaN(mNum)) {
            const monthMap = {1:'一', 2:'二', 3:'三', 4:'四', 5:'五', 6:'六', 7:'七', 8:'八', 9:'九', 10:'十', 11:'十一', 12:'十二'};
            const mKanji = monthMap[mNum] || mNum;
            const mPad = String(mNum).padStart(2, '0');
            const dPad = parts[2] ? String(parseInt(parts[2], 10)).padStart(2, '0') : '00';
            return { groupKey: `${y}-${mPad}`, exactKey: `${y}-${mPad}-${dPad}`, label: `${toKanjiNum(y)}年 ${mKanji}月` };
        }
    }

    return { groupKey: '0000-00', exactKey: '0000-00-00', label: '過去作品' };
}

window.onload = function() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

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

/* メインデータの受信と「西田上酢」「西田亮太」の厳密な作者絞り込み */
window.mainDataReceived = function(data) {
    try {
        if (!data || !data.table || !data.table.rows) return;
        const rows = data.table.rows;
        haikuHistory = [];
        let authorMap = {};

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

            const author = getVal(1) || '西田上酢';
            const authorKana = getVal(2) || 'にしだうえす';

            // 「西田上酢」「西田亮太」以外の他人の俳句を完全除外
            const isMyAuthor = (author === '西田上酢' || author === '西田亮太' || author === 'UES' || !author);
            if (!isMyAuthor) continue;

            const status = getVal(10) || '完成句';
            const rawDate = getVal(11);
            const rowIndex = i + 1;

            haikuHistory.push({
                phrase, author, authorKana,
                kigo: getVal(3), 
                parentKigo: getVal(4),
                season: getVal(6), detailSeason: getVal(7),
                status: status, sakkuDate: rawDate,
                rowIndex: rowIndex
            });

            if (author && author !== '作者名') {
                authorMap[author] = authorKana || author;
            }
        }

        authorDatabase = Object.keys(authorMap).map(name => ({ name, kana: authorMap[name] }));
        updateAuthorDatalist();

        if (document.getElementById('readScreen').classList.contains('active')) {
            renderYomuList();
        }
    } catch (e) {
        console.error('メインデータ解析エラー', e);
    }
};

function fetchSaijikiMasterData() {
    const sheetName = encodeURIComponent('歳時記データベース');
    const script = document.createElement('script');
    script.src = `https://docs.google.com/spreadsheets/d/${SAIJIKI_SPREADSHEET_ID}/gviz/tq?sheet=${sheetName}&range=A:F&tqx=responseHandler:saijikiDataReceived`;
    document.body.appendChild(script);
}

window.saijikiDataReceived = function(data) {
    try {
        if (!data || !data.table || !data.table.rows) return;
        const rows = data.table.rows;
        let kigoList = [];

        for (let i = 0; i < rows.length; i++) {
            const c = rows[i].c;
            if (!c) continue;

            const getVal = (idx) => (c[idx] && c[idx].v !== null) ? String(c[idx].v).trim() : '';
            const parentKigo = getVal(2);
            const childKigo = getVal(4);

            if (childKigo && childKigo !== '子季語') {
                kigoList.push({ kigo: childKigo, parentKigo: parentKigo || childKigo, parentKana: getVal(3), season: parseSeasonCode(getVal(0)), detailSeason: getVal(1) });
            }
            if (parentKigo && parentKigo !== '親季語') {
                kigoList.push({ kigo: parentKigo, parentKigo: parentKigo, parentKana: getVal(3), season: parseSeasonCode(getVal(0)), detailSeason: getVal(1) });
            }
        }
        let uniqueMap = {};
        kigoList.forEach(item => { if (!uniqueMap[item.kigo]) uniqueMap[item.kigo] = item; });
        saijikiDatabase = Object.values(uniqueMap);
        localStorage.setItem('hugetsu_saijiki_db', JSON.stringify(saijikiDatabase));
    } catch (e) {}
};

function parseSeasonCode(str) {
    if (!str) return 'haru';
    const s = str.toLowerCase().trim();
    if (s.includes('haru') || s === '春') return 'haru';
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
    if (!cat) return;
    if (show) cat.classList.remove('hidden');
    else cat.classList.add('hidden');
}

function goToStartScreen() {
    updateCatVisibility(false);
    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    document.getElementById('startScreen').classList.add('active');
}

function startEmuMode() {
    updateCatVisibility(false);
    editingHaikuObj = null;
    currentHaikuData.rowIndex = 0;
    document.getElementById('inputPhrase').value = '';
    document.getElementById('authorInput').value = '西田上酢';
    document.getElementById('authorKanaInput').value = 'にしだうえす';
    goToStep(1);
    const input = document.getElementById('inputPhrase');
    if (input) input.focus();
}

function cancelEmuMode() {
    if (editingHaikuObj) startYomuMode();
    else goToStartScreen();
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
    if (wrapper && input) {
        wrapper.classList.add('expanded');
        input.focus();
    }
}

function collapseSearchIfEmpty() {
    const wrapper = document.getElementById('searchWrapper');
    const input = document.getElementById('kigoFilterInput');
    if (wrapper && input && input.value.trim() === '') {
        wrapper.classList.remove('expanded');
    }
}

function onKigoFilterInputChanged() {
    const query = document.getElementById('kigoFilterInput').value.trim();
    const clearBtn = document.getElementById('clearKigoFilterBtn');
    if (clearBtn) clearBtn.classList.toggle('hidden', query === '');
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

/* 縦書き一覧描画（左＝古い過去句 ➔ 右スクロール＝一番右が最新句 に完全統一） */
function renderYomuList() {
    const container = document.getElementById('readHaikuList');
    if (!container) return;
    container.innerHTML = '';

    const filterQuery = document.getElementById('kigoFilterInput') ? document.getElementById('kigoFilterInput').value.trim().toLowerCase() : '';

    const targetHaikus = haikuHistory.filter(h => {
        const matchTab = (h.status === currentReadTab);
        let matchKigo = true;
        if (filterQuery !== '') {
            const targetStr = ((h.parentKigo || '') + ' ' + (h.kigo || '')).toLowerCase();
            matchKigo = targetStr.includes(filterQuery);
        }
        return matchTab && matchKigo;
    });

    if (targetHaikus.length === 0) {
        const msg = filterQuery ? `「${filterQuery}」に該当する${currentReadTab}はありません。` : `登録された${currentReadTab}はありません。`;
        container.innerHTML = `<div style="text-align:center; color:#888; margin:auto; font-size:0.9rem;">${msg}</div>`;
        return;
    }

    targetHaikus.forEach(item => {
        item._parsedDate = parseDateLabel(item.sakkuDate);
    });

    // 左＝過去（古い順） ➔ 右＝未来（新しい順・最新句が一番右）の昇順ソート
    targetHaikus.sort((a, b) => {
        if (a._parsedDate.groupKey !== b._parsedDate.groupKey) {
            return a._parsedDate.groupKey.localeCompare(b._parsedDate.groupKey);
        }
        return a._parsedDate.exactKey.localeCompare(b._parsedDate.exactKey);
    });

    let lastGroupKey = '';

    targetHaikus.forEach(item => {
        const dateInfo = item._parsedDate;
        
        if (dateInfo.groupKey !== lastGroupKey) {
            lastGroupKey = dateInfo.groupKey;
            const divider = document.createElement('div');
            divider.className = 'date-divider-card';
            divider.innerText = dateInfo.label;
            container.appendChild(divider);
        }

        const card = document.createElement('div');
        card.className = 'saijiki-haiku-card';
        card.onclick = () => onHaikuCardClicked(item);
        card.innerHTML = `<div class="saijiki-phrase">${item.phrase}</div>`;
        container.appendChild(card);
    });

    // 開いた時に自動で一番右端（最新句）にスクロールを合わせる
    requestAnimationFrame(() => {
        container.scrollLeft = container.scrollWidth;
    });
}

/* モーダル表示 */
function onHaikuCardClicked(haikuObj) {
    activeSelectedHaiku = haikuObj;
    document.getElementById('modalPhrase').innerText = haikuObj.phrase;

    const actionsContainer = document.getElementById('modalActions');
    if (!actionsContainer) return;

    if (haikuObj.status === '完成句') {
        actionsContainer.innerHTML = `
            <span class="text-action-btn primary" onclick="editSelectedHaiku()">修正</span>
            <span class="action-divider">|</span>
            <span class="text-action-btn" onclick="moveHaikuToDraft()">下書きへ</span>
            <span class="action-divider">|</span>
            <span class="text-action-btn" onclick="closeHaikuDetailModal()">閉じる</span>
        `;
    } else {
        actionsContainer.innerHTML = `
            <span class="text-action-btn primary" onclick="editSelectedHaiku()">修正</span>
            <span class="action-divider">|</span>
            <span class="text-action-btn danger" onclick="deleteSelectedDraft()">削除</span>
            <span class="action-divider">|</span>
            <span class="text-action-btn" onclick="closeHaikuDetailModal()">閉じる</span>
        `;
    }

    document.getElementById('haikuDetailModal').classList.remove('hidden');
}

function closeHaikuDetailModal() {
    document.getElementById('haikuDetailModal').classList.add('hidden');
}

function moveHaikuToDraft() {
    if (!activeSelectedHaiku) return;
    closeHaikuDetailModal();

    const params = new URLSearchParams();
    params.append('action', 'changeStatus');
    params.append('status', '下書き');
    params.append('rowIndex', activeSelectedHaiku.rowIndex);

    fetch(GAS_WEB_APP_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    }).then(() => {
        setTimeout(fetchMainHaikuData, 1200);
    });
}

function deleteSelectedDraft() {
    if (!activeSelectedHaiku) return;
    
    if (!confirm('この下書きを本当に削除しますか？\n（スプレッドシートから完全に消去されます）')) {
        return;
    }

    closeHaikuDetailModal();

    const params = new URLSearchParams();
    params.append('action', 'delete');
    params.append('rowIndex', activeSelectedHaiku.rowIndex);

    fetch(GAS_WEB_APP_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    }).then(() => {
        setTimeout(fetchMainHaikuData, 1200);
    });
}

/* おみ句じ猫機能 */
function triggerRandomOmikuji() {
    const kanseiList = haikuHistory.filter(h => h.status === '完成句');
    omikujiPool = kanseiList.length > 0 ? [...kanseiList] : [...haikuHistory];

    if (omikujiPool.length === 0) {
        alert('鑑賞できる俳句がまだありません。');
        return;
    }

    for (let i = omikujiPool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [omikujiPool[i], omikujiPool[j]] = [omikujiPool[j], omikujiPool[i]];
    }

    omikujiIndex = 0;
    renderOmikujiDisplay();

    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    document.getElementById('omikujiRoomScreen').classList.add('active');
    updateCatVisibility(true);
}

function changeOmikujiHaiku(direction) {
    if (omikujiIndex + direction >= 0 && omikujiIndex + direction < omikujiPool.length) {
        omikujiIndex += direction;
        renderOmikujiDisplay();
    }
}

function renderOmikujiDisplay() {
    const target = omikujiPool[omikujiIndex];
    if (!target) return;

    document.getElementById('omikujiPhrase').innerText = target.phrase;

    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    if (prevBtn) prevBtn.classList.toggle('disabled', omikujiIndex === 0);
    if (nextBtn) nextBtn.classList.toggle('disabled', omikujiIndex === omikujiPool.length - 1);
}

function initKeyboardEvents() {
    document.addEventListener('keydown', function(e) {
        const omikujiScreen = document.getElementById('omikujiRoomScreen');
        if (!omikujiScreen || !omikujiScreen.classList.contains('active')) return;

        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;

        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            changeOmikujiHaiku(-1);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            changeOmikujiHaiku(1);
        }
    });
}

function initSwipeEvents() {
    const room = document.getElementById('omikujiRoomScreen');
    if (!room) return;

    room.addEventListener('touchstart', function(e) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    room.addEventListener('touchend', function(e) {
        const diffX = e.changedTouches[0].clientX - touchStartX;
        const diffY = e.changedTouches[0].clientY - touchStartY;
        if (Math.abs(diffX) > 35 && Math.abs(diffX) > Math.abs(diffY)) {
            if (diffX > 0) changeOmikujiHaiku(1);
            else changeOmikujiHaiku(-1);
        }
    }, { passive: true });
}

function editSelectedHaiku() {
    closeHaikuDetailModal();
    if (!activeSelectedHaiku) return;

    editingHaikuObj = activeSelectedHaiku;
    currentHaikuData.rowIndex = activeSelectedHaiku.rowIndex || 0;
    
    document.getElementById('inputPhrase').value = activeSelectedHaiku.phrase;
    document.getElementById('kigoInput').value = activeSelectedHaiku.parentKigo || activeSelectedHaiku.kigo || '';
    if (activeSelectedHaiku.season) document.getElementById('seasonSelect').value = activeSelectedHaiku.season;
    if (activeSelectedHaiku.detailSeason) document.getElementById('detailSeasonSelect').value = activeSelectedHaiku.detailSeason;
    document.getElementById('authorInput').value = activeSelectedHaiku.author || '西田上酢';
    document.getElementById('authorKanaInput').value = activeSelectedHaiku.authorKana || 'にしだうえす';
    if (activeSelectedHaiku.sakkuDate) document.getElementById('sakkuDateInput').value = activeSelectedHaiku.sakkuDate;

    goToStep(1);
    const input = document.getElementById('inputPhrase');
    if (input) input.focus();
}

function goToStep(stepNumber) {
    updateCatVisibility(false);
    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    document.getElementById(`step${stepNumber}`).classList.add('active');
}

function goToStep2() {
    const phraseInput = document.getElementById('inputPhrase').value.trim();
    if (!phraseInput) {
        alert('句を入力してください。');
        return;
    }
    currentHaikuData.phrase = phraseInput;
    detectKigo(phraseInput);
    goToStep(2);
}

function detectKigo(phrase) {
    let detected = null;
    const cleanPhrase = phrase.replace(/\s+/g, '');

    if (saijikiDatabase && saijikiDatabase.length > 0) {
        let sorted = [...saijikiDatabase].sort((a, b) => b.kigo.length - a.kigo.length);
        for (let item of sorted) {
            if (cleanPhrase.includes(item.kigo)) {
                detected = item;
                break;
            }
        }
    }

    const promptEl = document.getElementById('detectedKigoText');
    if (detected) {
        if (promptEl) promptEl.innerText = `${detected.kigo}`;
        document.getElementById('kigoInput').value = detected.parentKigo;
        document.getElementById('seasonSelect').value = detected.season || 'huyu';
        if (document.getElementById('detailSeasonSelect')) document.getElementById('detailSeasonSelect').value = detected.detailSeason || '';

        currentHaikuData.kigo = detected.kigo;
        currentHaikuData.parentKigo = detected.parentKigo;
        currentHaikuData.parentKana = detected.parentKana || '';
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
    
    const authorVal = document.getElementById('authorInput').value.trim();
    const authorKanaVal = document.getElementById('authorKanaInput').value.trim();
    const dateVal = document.getElementById('sakkuDateInput').value;

    currentHaikuData.author = authorVal || '西田上酢';
    currentHaikuData.authorKana = authorKanaVal || 'にしだうえす';
    currentHaikuData.sakkuDate = dateVal || getTodayDateString();

    document.getElementById('previewPhrase').innerText = currentHaikuData.phrase;
    document.getElementById('previewAuthor').innerText = currentHaikuData.author;

    let seasonJa = {'haru':'春', 'natsu':'夏', 'aki':'秋', 'huyu':'冬', 'shinnen':'新年', 'muki':'無季'}[currentHaikuData.season] || currentHaikuData.season;
    let kigoStr = currentHaikuData.parentKigo || '無季';
    let detailSuffix = currentHaikuData.detailSeason ? `（${currentHaikuData.detailSeason}）` : '';
    
    document.getElementById('previewBreadcrumb').innerHTML = 
        `<span>季寄せ</span> <span class="separator">&lt;</span> <span>${seasonJa}</span> <span class="separator">&lt;</span> <span>${kigoStr}${detailSuffix}</span>`;

    goToStep(3);
}

function submitHaiku(statusType) {
    currentHaikuData.status = statusType;

    const authorVal = document.getElementById('authorInput').value.trim();
    const authorKanaVal = document.getElementById('authorKanaInput').value.trim();
    const dateVal = document.getElementById('sakkuDateInput').value;

    const payload = {
        action: 'save',
        phrase: currentHaikuData.phrase,
        author: authorVal || currentHaikuData.author || '西田上酢',
        authorKana: authorKanaVal || currentHaikuData.authorKana || 'にしだうえす',
        kigo: currentHaikuData.kigo || currentHaikuData.parentKigo,
        parentKigo: currentHaikuData.parentKigo,
        parentKana: currentHaikuData.parentKana,
        season: currentHaikuData.season,
        detailSeason: currentHaikuData.detailSeason,
        status: statusType,
        sakkuDate: dateVal || currentHaikuData.sakkuDate || getTodayDateString(),
        rowIndex: currentHaikuData.rowIndex || 0
    };

    const compTitle = document.getElementById('completeTitle');
    if (compTitle) compTitle.innerText = `${statusType}として保存しました`;

    const params = new URLSearchParams();
    for (let key in payload) {
        params.append(key, payload[key]);
    }

    fetch(GAS_WEB_APP_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    }).then(() => {
        setTimeout(fetchMainHaikuData, 1500);
        goToStep(4);
    }).catch(err => {
        console.error(err);
        saveToOfflineQueue(payload);
        goToStep(4);
    });
}

function finishAndReturn() {
    if (editingHaikuObj) editingHaikuObj = null;
    currentHaikuData.rowIndex = 0;
    startYomuMode();
}

function saveToOfflineQueue(data) {
    let queue = [];
    try {
        const stored = localStorage.getItem('hugetsu_offline_queue');
        if (stored) queue = JSON.parse(stored);
    } catch (e) {}
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
            const params = new URLSearchParams();
            for (let key in item) params.append(key, item[key]);
            fetch(GAS_WEB_APP_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: params.toString()
            });
        });
        localStorage.removeItem('hugetsu_offline_queue');
        setTimeout(fetchMainHaikuData, 1500);
    } catch (e) {}
}

function resetForm() {
    document.getElementById('inputPhrase').value = '';
    document.getElementById('kigoInput').value = '';
    currentHaikuData.rowIndex = 0;
    goToStep(1);
}
