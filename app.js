// ① 「風月」自身のスプレッドシートID（登録・閲覧用）
const SPREADSHEET_ID = '1m0y8AOJNx1Ad4I44poPheQAQNki1-QQIwi9wSw8jaBg';

// ② 共通の「歳時記データベース」スプレッドシートID
const SAIJIKI_SPREADSHEET_ID = '1EOmZn53hFA8GpVdcn--aU-lj9uHjGQpnSZ1o9jbnsYs';

// Webアプリ（GAS）のURL
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwgm4eh8qZGRxvFS8_b8iEJAC9vRGw31gOvjgsPQMPc1ymU4oKonErvUkL0Ucf6xnZO/exec';

let saijikiDatabase = []; 
let authorDatabase = [];  
let haikuHistory = [];    

let currentReadTab = '完成句'; 
let editingDraftHaiku = null; 
let activeSelectedHaiku = null; 

let omikujiPool = [];
let omikujiIndex = 0;

let touchStartX = 0;
let touchStartY = 0;

let currentHaikuData = {
    phrase: '', kigo: '', parentKigo: '', parentKana: '',
    season: 'haru', detailSeason: '', author: '西田上酢', authorKana: 'にしだうえす',
    sakkuDate: '', status: '完成句'
};

function getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// 数字を漢数字（2023 ➔ 二〇二三）に変換
function toKanjiNum(str) {
    const numMap = {'0':'〇', '1':'一', '2':'二', '3':'三', '4':'四', '5':'五', '6':'六', '7':'七', '8':'八', '9':'九'};
    return String(str).split('').map(char => numMap[char] || char).join('');
}

// 「2023」「2023-05」「2023-05-12」など様々な日付形式を縦書き見出しに変換
function toKanjiYearMonth(dateStr) {
    if (!dateStr) return '過去作品';
    const str = String(dateStr).trim();
    const parts = str.split(/[-/.]/);

    if (parts.length === 1 && parts[0].length === 4) {
        // 例: "2023"
        return `${toKanjiNum(parts[0])}年`;
    } else if (parts.length >= 2) {
        // 例: "2023-05" や "2023-05-12"
        const y = toKanjiNum(parts[0]);
        const mNum = parseInt(parts[1], 10);
        const monthMap = {1:'一', 2:'二', 3:'三', 4:'四', 5:'五', 6:'六', 7:'七', 8:'八', 9:'九', 10:'十', 11:'十一', 12:'十二'};
        const m = monthMap[mNum] || mNum;
        return `${y}年 ${m}月`;
    }

    return '過去作品';
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

    window.addEventListener('online', processOfflineQueue);
    processOfflineQueue();
};

function restoreCachedMasterData() {
    try {
        const cachedSaijiki = localStorage.getItem('hugetsu_saijiki_db');
        if (cachedSaijiki) saijikiDatabase = JSON.parse(cachedSaijiki);
    } catch (e) {}
}

/* スプレッドシートからのデータ全取得 */
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
            const status = getVal(10) || '完成句'; // K列
            
            let rawDate = getVal(11);
            if (rawDate.includes('Date(')) {
                const m = rawDate.match(/\d+/g);
                if (m && m.length >= 3) {
                    rawDate = `${m[0]}-${String(parseInt(m[1])+1).padStart(2,'0')}-${String(parseInt(m[2])).padStart(2,'0')}`;
                }
            }

            haikuHistory.push({
                phrase, author, authorKana,
                kigo: getVal(3), parentKigo: getVal(4),
                season: getVal(6), detailSeason: getVal(7),
                status: status, sakkuDate: rawDate
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

/* 歳時記データ取得 */
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

/* ナビゲーション */
function goToStartScreen() {
    updateCatVisibility(false);
    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    document.getElementById('startScreen').classList.add('active');
}

function startEmuMode() {
    updateCatVisibility(false);
    editingDraftHaiku = null;
    document.getElementById('inputPhrase').value = '';
    document.getElementById('authorInput').value = '西田上酢';
    document.getElementById('authorKanaInput').value = 'にしだうえす';
    goToStep(1);
    const input = document.getElementById('inputPhrase');
    if (input) input.focus();
}

function cancelEmuMode() {
    if (editingDraftHaiku) startYomuMode();
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

/* 一覧描画処理（「2023」などの年のみ入力にも対応） */
function renderYomuList() {
    const container = document.getElementById('readHaikuList');
    if (!container) return;
    container.innerHTML = '';

    const targetHaikus = haikuHistory.filter(h => h.status === currentReadTab);

    if (targetHaikus.length === 0) {
        container.innerHTML = `<div style="text-align:center; color:#888; margin:auto;">登録された${currentReadTab}はありません。</div>`;
        return;
    }

    // 新しい日付順にソート
    targetHaikus.sort((a, b) => (b.sakkuDate || '').localeCompare(a.sakkuDate || ''));

    let lastLabel = '';

    targetHaikus.forEach(item => {
        // 年月または年単位で区切りテキストを判定
        let currentLabel = '過去作品';
        if (item.sakkuDate) {
            const parts = item.sakkuDate.split(/[-/.]/);
            if (parts.length === 1 && parts[0].length === 4) {
                currentLabel = parts[0]; // 年のみ (2023)
            } else if (parts.length >= 2) {
                currentLabel = `${parts[0]}-${parts[1]}`; // 年月 (2023-05)
            }
        }
        
        if (currentLabel !== lastLabel) {
            lastLabel = currentLabel;
            const divider = document.createElement('div');
            divider.className = 'date-divider-card';
            divider.innerText = toKanjiYearMonth(item.sakkuDate);
            container.appendChild(divider);
        }

        const card = document.createElement('div');
        card.className = 'saijiki-haiku-card';
        card.onclick = () => onHaikuCardClicked(item);
        card.innerHTML = `<div class="saijiki-phrase">${item.phrase}</div>`;
        container.appendChild(card);
    });

    requestAnimationFrame(() => {
        container.scrollLeft = 0;
    });
}

function onHaikuCardClicked(haikuObj) {
    if (haikuObj.status === '下書き') {
        activeSelectedHaiku = haikuObj;
        document.getElementById('modalPhrase').innerText = haikuObj.phrase;
        document.getElementById('haikuDetailModal').classList.remove('hidden');
    }
}

function closeHaikuDetailModal() {
    document.getElementById('haikuDetailModal').classList.add('hidden');
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

function editDraftHaiku() {
    closeHaikuDetailModal();
    if (!activeSelectedHaiku) return;

    editingDraftHaiku = activeSelectedHaiku;
    
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
        phrase: currentHaikuData.phrase,
        author: authorVal || currentHaikuData.author || '西田上酢',
        authorKana: authorKanaVal || currentHaikuData.authorKana || 'にしだうえす',
        kigo: currentHaikuData.kigo || currentHaikuData.parentKigo,
        parentKigo: currentHaikuData.parentKigo,
        parentKana: currentHaikuData.parentKana,
        season: currentHaikuData.season,
        detailSeason: currentHaikuData.detailSeason,
        status: statusType,
        sakkuDate: dateVal || currentHaikuData.sakkuDate || getTodayDateString()
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
    if (editingDraftHaiku) editingDraftHaiku = null;
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
    goToStep(1);
}
