// ① 「風月」自身のスプレッドシートID（登録・閲覧用）
const SPREADSHEET_ID = '1m0y8AOJNx1Ad4I44poPheQAQNki1-QQIwi9wSw8jaBg';

// ② 共通の「歳時記データベース」スプレッドシートID
const SAIJIKI_SPREADSHEET_ID = '1EOmZn53hFA8GpVdcn--aU-lj9uHjGQpnSZ1o9jbnsYs';

// Webアプリ（GAS）のURL
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwgm4eh8qZGRxvFS8_b8iEJAC9vRGw31gOvjgsPQMPc1ymU4oKonErvUkL0Ucf6xnZO/exec';

let saijikiDatabase = []; // 歳時記データベース
let authorDatabase = [];  // 作者マスター
let haikuHistory = [];    // 読み込んだ全俳句データ

let currentReadTab = '完成句'; // 「読む」画面の初期タブ

let currentHaikuData = {
    phrase: '',
    kigo: '',
    parentKigo: '',
    parentKana: '',
    season: 'haru',
    detailSeason: '',
    author: '西田上酢',
    authorKana: 'にしだ じょうす',
    sakkuDate: '',
    status: '完成句'
};

// ローカル（端末）の今日の日付を YYYY-MM-DD 形式で取得する関数
function getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

window.onload = function() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // 今日の日付をカレンダーの初期値にセット
    const todayInput = document.getElementById('sakkuDateInput');
    if (todayInput) {
        todayInput.value = getTodayDateString();
    }

    restoreCachedMasterData();
    fetchMainHaikuData();
    fetchSaijikiMasterData();

    window.addEventListener('online', processOfflineQueue);
    processOfflineQueue();
};

function restoreCachedMasterData() {
    try {
        const cachedSaijiki = localStorage.getItem('hugetsu_saijiki_db');
        if (cachedSaijiki) saijikiDatabase = JSON.parse(cachedSaijiki);
    } catch (e) {}
}

/* メインの「俳句集成」シートからデータ全取得 */
function fetchMainHaikuData() {
    const script = document.createElement('script');
    script.src = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?range=A:L&tqx=responseHandler:mainDataReceived&_=${new Date().getTime()}`;
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

            const getVal = (idx) => (c[idx] && c[idx].v !== null) ? String(c[idx].v).trim() : '';
            
            const phrase = getVal(0);
            const author = getVal(1);
            const authorKana = getVal(2);
            const status = getVal(10) || '完成句'; // K列
            const sakkuDate = getVal(11);          // L列

            if (phrase && phrase !== '俳句' && phrase !== '句') {
                haikuHistory.push({
                    phrase, author, authorKana,
                    kigo: getVal(3), parentKigo: getVal(4),
                    season: getVal(6), detailSeason: getVal(7),
                    status, sakkuDate
                });
            }

            if (author && author !== '作者名') {
                authorMap[author] = authorKana || author;
            }
        }

        authorDatabase = Object.keys(authorMap).map(name => ({ name, kana: authorMap[name] }));
        updateAuthorDatalist();
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
    if (s.includes('fuyu') || s.includes('huyu') || s === '冬') return 'huyu';
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

function goToStartScreen() {
    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    document.getElementById('startScreen').classList.add('active');
}

function startEmuMode() {
    goToStep(1);
    const input = document.getElementById('inputPhrase');
    if (input) input.focus();
}

function startYomuMode() {
    renderYomuList();
    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    document.getElementById('readScreen').classList.add('active');
}

function switchReadTab(status) {
    currentReadTab = status;
    document.getElementById('tabKansei').classList.toggle('active', status === '完成句');
    document.getElementById('tabShitagaki').classList.toggle('active', status === '下書き');
    renderYomuList();
}

function renderYomuList() {
    const container = document.getElementById('readHaikuList');
    if (!container) return;
    container.innerHTML = '';

    const myHaikus = haikuHistory.filter(h => h.author === '西田上酢' && h.status === currentReadTab);

    if (myHaikus.length === 0) {
        container.innerHTML = `<div style="text-align:center; color:#888; margin-top:40px;">登録された${currentReadTab}はありません。</div>`;
        return;
    }

    myHaikus.forEach(item => {
        const card = document.createElement('div');
        card.className = 'haiku-card';
        card.innerHTML = `
            <div class="haiku-card-phrase">${item.phrase}</div>
            <div class="haiku-card-meta">
                <span>季語: ${item.parentKigo || '無季'}</span>
                <span>${item.sakkuDate ? item.sakkuDate : ''}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

function goToStep(stepNumber) {
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
    currentHaikuData.authorKana = authorKanaVal || 'にしだ じょうす';
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

/* 確実な送信処理（URLSearchParams形式） */
function submitHaiku(statusType) {
    currentHaikuData.status = statusType;

    const authorVal = document.getElementById('authorInput').value.trim();
    const authorKanaVal = document.getElementById('authorKanaInput').value.trim();
    const dateVal = document.getElementById('sakkuDateInput').value;

    const payload = {
        phrase: currentHaikuData.phrase,
        author: authorVal || currentHaikuData.author || '西田上酢',
        authorKana: authorKanaVal || currentHaikuData.authorKana || 'にしだ じょうす',
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

    // FormData形式に変換して送信
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
        setTimeout(fetchMainHaikuData, 1000); // 1秒後に最新一覧を再読み込み
        goToStep(4);
    }).catch(err => {
        console.error(err);
        saveToOfflineQueue(payload);
        goToStep(4);
    });
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
        setTimeout(fetchMainHaikuData, 1000);
    } catch (e) {}
}

function resetForm() {
    document.getElementById('inputPhrase').value = '';
    document.getElementById('kigoInput').value = '';
    goToStep(1);
}
