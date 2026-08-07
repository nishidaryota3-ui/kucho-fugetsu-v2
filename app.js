// ① 「風月」自身のスプレッドシートID（1枚目「俳句集成」・登録用）
const SPREADSHEET_ID = '1m0y8AOJNx1Ad4I44poPheQAQNki1-QQIwi9wSw8jaBg';

// ② 共通の「歳時記データベース」専用スプレッドシートID（独立マスターを参照）
const SAIJIKI_SPREADSHEET_ID = '1EOmZn53hFA8GpVdcn--aU-lj9uHjGQpnSZ1o9jbnsYs';

// Webアプリ（GAS）のURL
const GAS_WEB_APP_URL = 'https://script.google.com/macros/s/AKfycbwgm4eh8qZGRxvFS8_b8iEJAC9vRGw31gOvjgsPQMPc1ymU4oKonErvUkL0Ucf6xnZO/exec';

let saijikiDatabase = []; // 共通：歳時記データベース（季語照会用）
let authorDatabase = [];  // 風月独自：俳句集成（作者サジェスト用）

let currentHaikuData = {
    phrase: '',
    kigo: '',         // D列用: 子季語/表記季語
    parentKigo: '',   // E列用: 親季語
    parentKana: '',   // F列用: 季語よみがな
    season: 'haru',   // G列用: 季節コード
    detailSeason: '', // H列用: 詳細季節
    author: '',
    authorKana: ''
};

window.onload = function() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    restoreCachedMasterData();
    
    // 自身（風月）の1枚目「俳句集成」から作者データを取得
    fetchAuthorMasterData();

    // 独立した共通スプレッドシートから季語データを取得
    fetchSaijikiMasterData();

    window.addEventListener('online', processOfflineQueue);
    processOfflineQueue();
};

function restoreCachedMasterData() {
    try {
        const cachedSaijiki = localStorage.getItem('hugetsu_saijiki_db');
        const cachedAuthor = localStorage.getItem('hugetsu_author_db');
        
        if (cachedSaijiki) saijikiDatabase = JSON.parse(cachedSaijiki);
        if (cachedAuthor) {
            authorDatabase = JSON.parse(cachedAuthor);
            updateAuthorDatalist();
        }
    } catch (e) {
        console.error('マスターキャッシュ復元エラー', e);
    }
}

/* 1枚目「俳句集成」（風月側）から作者データ取得 */
function fetchAuthorMasterData() {
    const script = document.createElement('script');
    script.src = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?range=A:C&tqx=responseHandler:authorDataReceived`;
    document.body.appendChild(script);
}

window.authorDataReceived = function(data) {
    try {
        if (!data || !data.table || !data.table.rows) return;
        const rows = data.table.rows;
        let authorMap = {};

        for (let i = 0; i < rows.length; i++) {
            const c = rows[i].c;
            if (!c) continue;

            const getVal = (idx) => (c[idx] && c[idx].v !== null) ? String(c[idx].v).trim() : '';
            const author = getVal(1);      
            const authorKana = getVal(2);  

            if (author && author !== '作者名' && author !== '作者不詳') {
                if (!authorMap[author]) {
                    authorMap[author] = authorKana || author;
                }
            }
        }

        authorDatabase = Object.keys(authorMap).map(name => ({
            name: name,
            kana: authorMap[name]
        }));
        authorDatabase.sort((a, b) => a.kana.localeCompare(b.kana, 'ja'));

        localStorage.setItem('hugetsu_author_db', JSON.stringify(authorDatabase));
        updateAuthorDatalist();
    } catch (e) {
        console.error('作者マスター解析エラー', e);
    }
};

/* 🌐 独立した「歳時記データベース」スプレッドシートから季語データを共通取得 */
function fetchSaijikiMasterData() {
    const sheetName = encodeURIComponent('歳時記データベース');
    const script = document.createElement('script');
    // SAIJIKI_SPREADSHEET_ID を使用
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
            
            const rawSeason = getVal(0);            // A列: 季節
            const detailSeason = getVal(1);         // B列: 詳細季節
            const parentKigo = getVal(2);           // C列: 親季語
            const parentKana = getVal(3);           // D列: 親季語よみがな
            const childKigo = getVal(4);            // E列: 子季語

            const seasonCode = parseSeasonCode(rawSeason);

            if (childKigo && childKigo !== '子季語') {
                kigoList.push({
                    kigo: childKigo,
                    parentKigo: parentKigo || childKigo,
                    parentKana: parentKana,
                    season: seasonCode,
                    detailSeason: detailSeason
                });
            }

            if (parentKigo && parentKigo !== '親季語') {
                kigoList.push({
                    kigo: parentKigo,
                    parentKigo: parentKigo,
                    parentKana: parentKana,
                    season: seasonCode,
                    detailSeason: detailSeason
                });
            }
        }

        let uniqueMap = {};
        kigoList.forEach(item => {
            if (!uniqueMap[item.kigo]) uniqueMap[item.kigo] = item;
        });
        saijikiDatabase = Object.values(uniqueMap);

        localStorage.setItem('hugetsu_saijiki_db', JSON.stringify(saijikiDatabase));
    } catch (e) {
        console.error('歳時記マスター解析エラー', e);
    }
};

function parseSeasonCode(str) {
    if (!str) return 'haru';
    const s = str.toLowerCase().trim();
    if (s.includes('haru') || s === '春') return 'haru';
    if (s.includes('natsu') || s === '夏') return 'natsu';
    if (s.includes('aki') || s === '秋') return 'aki';
    if (s.includes('fuyu') || s.includes('huyu') || s === '冬') return 'huyu';
    if (s.includes('shinnen') || s.includes('sinnen') || s === '新年') return 'shinnen';
    if (s.includes('muki') || s === '無季') return 'muki';
    return 'haru';
}

function updateAuthorDatalist() {
    const authorListEl = document.getElementById('authorList');
    if (!authorListEl) return;

    authorListEl.innerHTML = '';
    authorDatabase.forEach(item => {
        if (!item || !item.name) return;
        const opt = document.createElement('option');
        opt.value = item.kana ? `${item.name}（${item.kana}）` : item.name;
        authorListEl.appendChild(opt);
    });
}

function goToStep(stepNumber) {
    document.querySelectorAll('.step-screen').forEach(el => el.classList.remove('active'));
    const target = document.getElementById(`step${stepNumber}`);
    if (target) target.classList.add('active');
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
        let sortedDatabase = [...saijikiDatabase].sort((a, b) => b.kigo.length - a.kigo.length);

        for (let item of sortedDatabase) {
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
        
        const detailSelect = document.getElementById('detailSeasonSelect');
        if (detailSelect) detailSelect.value = detected.detailSeason || '';

        currentHaikuData.kigo = detected.kigo;
        currentHaikuData.parentKigo = detected.parentKigo;
        currentHaikuData.parentKana = detected.parentKana || '';
    } else {
        if (promptEl) promptEl.innerText = '見つかりませんでした（手動でご入力ください）';
        document.getElementById('kigoInput').value = '';
        document.getElementById('seasonSelect').value = 'haru';
        
        const detailSelect = document.getElementById('detailSeasonSelect');
        if (detailSelect) detailSelect.value = '';
        
        currentHaikuData.kigo = '';
        currentHaikuData.parentKigo = '';
        currentHaikuData.parentKana = '';
    }
}

function checkAndHokanKigoData() {
    const val = document.getElementById('kigoInput').value.trim();
    if (!val) return;

    let hit = saijikiDatabase.find(item => item.kigo === val || item.parentKigo === val);
    if (hit) {
        if (hit.season) document.getElementById('seasonSelect').value = hit.season;
        const detailSelect = document.getElementById('detailSeasonSelect');
        if (detailSelect && hit.detailSeason) detailSelect.value = hit.detailSeason;
        currentHaikuData.parentKana = hit.parentKana || '';
    }
}

function onAuthorNameChange() {
    let nameVal = document.getElementById('authorInput').value.trim();
    if (!nameVal) return;

    if (nameVal.includes('（')) {
        const parts = nameVal.split('（');
        nameVal = parts[0];
        const kanaPart = parts[1].replace('）', '');
        document.getElementById('authorInput').value = nameVal;
        document.getElementById('authorKanaInput').value = kanaPart;
        return;
    }

    const hit = authorDatabase.find(item => item.name === nameVal);
    if (hit) {
        document.getElementById('authorKanaInput').value = hit.kana;
    }
}

function onAuthorInputChanged() {
    onAuthorNameChange();
}

function onAuthorKanaInputChanged() {
    const kanaVal = document.getElementById('authorKanaInput').value.trim();
    if (!kanaVal) return;

    const hit = authorDatabase.find(item => item.kana === kanaVal);
    if (hit) {
        document.getElementById('authorInput').value = hit.name;
    }
}

function goToStep3() {
    const inputKigoVal = document.getElementById('kigoInput').value.trim();
    
    let hit = saijikiDatabase.find(item => item.kigo === inputKigoVal || item.parentKigo === inputKigoVal);

    currentHaikuData.parentKigo = inputKigoVal;
    currentHaikuData.kigo = (hit && hit.kigo !== hit.parentKigo) ? hit.kigo : inputKigoVal;
    currentHaikuData.parentKana = hit ? (hit.parentKana || '') : '';
    currentHaikuData.season = document.getElementById('seasonSelect').value;
    
    const detailSelect = document.getElementById('detailSeasonSelect');
    currentHaikuData.detailSeason = detailSelect ? detailSelect.value : '';
    
    currentHaikuData.author = document.getElementById('authorInput').value.trim() || '西田亮太';
    currentHaikuData.authorKana = document.getElementById('authorKanaInput').value.trim();

    document.getElementById('previewPhrase').innerText = currentHaikuData.phrase;
    document.getElementById('previewAuthor').innerText = currentHaikuData.author;

    let seasonJa = getSeasonNameJa(currentHaikuData.season);
    let kigoStr = currentHaikuData.parentKigo || '無季';
    let detailSuffix = currentHaikuData.detailSeason ? `（${currentHaikuData.detailSeason}）` : '';
    
    document.getElementById('previewBreadcrumb').innerHTML = 
        `<span>季寄せ</span> <span class="separator">&lt;</span> <span>${seasonJa}</span> <span class="separator">&lt;</span> <span>${kigoStr}${detailSuffix}</span>`;

    goToStep(3);
}

function submitHaiku() {
    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.innerText = '送信中...';

    const payload = {
        phrase: currentHaikuData.phrase,
        author: currentHaikuData.author,
        authorKana: currentHaikuData.authorKana,
        kigo: currentHaikuData.kigo || currentHaikuData.parentKigo,
        parentKigo: currentHaikuData.parentKigo,
        parentKana: currentHaikuData.parentKana,
        season: currentHaikuData.season,
        detailSeason: currentHaikuData.detailSeason,
        timestamp: new Date().toISOString()
    };

    if (navigator.onLine) {
        sendToGas(payload)
            .then(() => {
                submitBtn.disabled = false;
                submitBtn.innerText = '登録する';
                goToStep(4);
            })
            .catch(() => {
                saveToOfflineQueue(payload);
                submitBtn.disabled = false;
                submitBtn.innerText = '登録する';
                alert('通信エラーのため、一時保存しました。次回オンライン時に自動送信されます。');
                goToStep(4);
            });
    } else {
        saveToOfflineQueue(payload);
        submitBtn.disabled = false;
        submitBtn.innerText = '登録する';
        goToStep(4);
    }
}

function sendToGas(data) {
    return fetch(GAS_WEB_APP_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
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

        let promises = queue.map(item => sendToGas(item));
        Promise.all(promises).then(() => {
            localStorage.removeItem('hugetsu_offline_queue');
        }).catch(e => console.error('オフラインキュー送信エラー', e));
    } catch (e) {
        console.error('キュー処理エラー', e);
    }
}

function resetForm() {
    document.getElementById('inputPhrase').value = '';
    document.getElementById('kigoInput').value = '';
    
    const detailSelect = document.getElementById('detailSeasonSelect');
    if (detailSelect) detailSelect.value = '';
    
    document.getElementById('authorInput').value = '';
    document.getElementById('authorKanaInput').value = '';
    
    goToStep(1);
}

function getSeasonNameJa(code) {
    const map = {'haru':'春', 'natsu':'夏', 'aki':'秋', 'huyu':'冬', 'shinnen':'新年', 'muki':'無季'};
    return map[code] || code;
}
