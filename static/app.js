const $ = (id) => document.getElementById(id);

// URL Query params boot check (for middle-click new tab opening)
const urlParams = new URLSearchParams(window.location.search);
const qSymbol = urlParams.get("symbol");
const qLong = urlParams.get("long_ex");
const qShort = urlParams.get("short_ex");

let state = {
    longEx: qLong || "Ondo",
    shortEx: qShort || "RH_Lighter",
    symbol: qSymbol ? qSymbol.toUpperCase() : "BTC",
    minSpread: 0.01,
    isRunning: true,
    entryAlert: null,
    exitAlert: null,
    lastAlertTime: 0
};

let chart, inSeries, outSeries;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playTactileClick() {
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const t = audioCtx.currentTime;

        // Ultra-creamy, silky iPhone key tap synth
        const bufferSize = Math.floor(audioCtx.sampleRate * 0.012);
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.35));
        }

        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;

        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(750, t);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.035, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(audioCtx.destination);

        noise.start(t);

        // Deep warm cream thud pop
        const osc = audioCtx.createOscillator();
        const oscGain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(450, t);
        osc.frequency.exponentialRampToValueAtTime(110, t + 0.010);
        oscGain.gain.setValueAtTime(0.03, t);
        oscGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.010);

        osc.connect(oscGain);
        oscGain.connect(audioCtx.destination);

        osc.start(t);
        osc.stop(t + 0.012);
    } catch (e) {}
}

function playSwooshSound(reverse = false) {
    try {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.type = 'sine';
        const startFreq = reverse ? 200 : 400;
        const endFreq = reverse ? 400 : 200;
        osc.frequency.setValueAtTime(startFreq, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(endFreq, audioCtx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.03, audioCtx.currentTime);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.1);
    } catch (e) {}
}

function playAlertSound() {
    // Не грати звук частіше ніж раз на 5 секунд
    if (Date.now() - state.lastAlertTime < 5000) return;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.1, audioCtx.currentTime);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
    state.lastAlertTime = Date.now();
}

function initChart() {
    if (!$("chart")) return;
    chart = LightweightCharts.createChart($("chart"), {
        layout: { background: { type: 'solid', color: 'transparent' }, textColor: '#848e9c' },
        grid: { vertLines: { color: '#2b2f36' }, horzLines: { color: '#2b2f36' } },
        timeScale: { timeVisible: true, secondsVisible: true },
    });
    inSeries = chart.addLineSeries({ color: '#2ebd85', lineWidth: 2 });
    outSeries = chart.addLineSeries({ color: '#f6465d', lineWidth: 2 });
}

let allSymbols = [];
let selectedIndex = -1;

async function loadSymbols() {
    try {
        const r = await fetch('/api/symbols');
        const d = await r.json();
        allSymbols = d.symbols || [];
        // Optional: set default symbol if not set
        if (!state.symbol && allSymbols.length > 0) {
            state.symbol = allSymbols[0];
        }
    } catch (e) {
        console.error("Failed to load symbols", e);
        allSymbols = ["BTC", "ETH", "SOL"]; // Fallback
    }
}

const CRYPTO_ALIASES = {
    'БТК': 'BTC',
    'ЕТХ': 'ETH',
    'ЕФІР': 'ETH',
    'СОЛ': 'SOL',
    'КУУ': 'QQQ',
    'СПЙ': 'SPY',
    'МОРФО': 'MORPHO',
    'РЕНДЕР': 'RENDER',
    'ААВЕ': 'AAVE',
    'ЗРО': 'ZRO',
    'ВВВ': 'VVV',
    'ГРАСС': 'GRASS',
    'АВАКС': 'AVAX'
};

const PHONETIC_MAP = {
    'а':'a', 'б':'b', 'в':'v', 'г':'g', 'ґ':'g', 'д':'d', 'е':'e', 'є':'e', 'ж':'zh', 'з':'z', 'и':'i', 'і':'i', 'ї':'i',
    'й':'y', 'к':'k', 'л':'l', 'м':'m', 'н':'n', 'о':'o', 'п':'p', 'р':'r', 'с':'s', 'т':'t', 'у':'u', 'ф':'f', 'х':'h',
    'ц':'c', 'ч':'ch', 'ш':'sh', 'щ':'sh', 'ь':'', 'ю':'u', 'я':'a', 'ы':'y', 'э':'e', 'ъ':'', 'ё':'yo'
};

const QWERTY_MAP = {
    'й':'q', 'ц':'w', 'у':'e', 'к':'r', 'е':'t', 'н':'y', 'г':'u', 'ш':'i', 'щ':'o', 'з':'p', 'х':'[', 'ї':']',
    'ф':'a', 'і':'s', 'в':'d', 'а':'f', 'п':'g', 'р':'h', 'о':'j', 'л':'k', 'д':'l', 'ж':';', 'є':"'",
    'я':'z', 'ч':'x', 'с':'c', 'м':'v', 'и':'b', 'т':'n', 'ь':'m', 'б':'b', 'ю':'u', 'ы':'s', 'э':"'", 'ъ':']'
};

function convertCyrillicToLatin(str) {
    if (!str) return '';
    const upperStr = str.trim().toUpperCase();
    if (CRYPTO_ALIASES[upperStr]) {
        return CRYPTO_ALIASES[upperStr];
    }
    
    // Convert phonetically first
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const lower = char.toLowerCase();
        if (PHONETIC_MAP[lower] !== undefined) {
            const converted = PHONETIC_MAP[lower];
            result += (char === char.toUpperCase() && char !== char.toLowerCase()) ? converted.toUpperCase() : converted;
        } else {
            result += char;
        }
    }
    return result;
}

function convertQWERTYLayout(str) {
    if (!str) return '';
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const lower = char.toLowerCase();
        if (QWERTY_MAP[lower] !== undefined) {
            const converted = QWERTY_MAP[lower];
            result += (char === char.toUpperCase() && char !== char.toLowerCase()) ? converted.toUpperCase() : converted;
        } else {
            result += char;
        }
    }
    return result;
}

function filterSymbols(query) {
    if (!query) return allSymbols;
    const qRaw = query.trim();
    const qUpper = qRaw.toUpperCase();
    const qPhonetic = convertCyrillicToLatin(qRaw).toUpperCase();
    const qQwerty = convertQWERTYLayout(qRaw).toUpperCase();

    return allSymbols.filter(s => {
        const sUpper = s.toUpperCase();
        return sUpper.startsWith(qUpper) || sUpper.startsWith(qPhonetic) || sUpper.startsWith(qQwerty) ||
               sUpper.includes(qUpper) || sUpper.includes(qPhonetic) || sUpper.includes(qQwerty);
    });
}

function showDropdown(symbols) {
    const dropdown = $("symbolDropdown");
    if (!dropdown) return;

    dropdown.innerHTML = "";
    selectedIndex = -1;

    if (!symbols || symbols.length === 0) {
        dropdown.classList.remove("show");
        return;
    }

    symbols.forEach((sym, idx) => {
        const opt = document.createElement("div");
        opt.className = "symbol-option";
        opt.innerHTML = `<span class="symbol-name">${sym}</span>`;
        opt.onmouseenter = () => playTactileClick();
        opt.onclick = (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            playTactileClick();
            window.selectSymbol(sym);
        };
        opt.dataset.index = idx;
        dropdown.appendChild(opt);
    });

    dropdown.classList.add("show");
}

function updateSelection(direction) {
    const dropdown = $("symbolDropdown");
    if (!dropdown) return;

    const options = dropdown.querySelectorAll(".symbol-option");
    if (options.length === 0) return;

    options.forEach(o => o.classList.remove("selected"));

    if (direction === "down") {
        selectedIndex = (selectedIndex + 1) % options.length;
    } else if (direction === "up") {
        selectedIndex = selectedIndex <= 0 ? options.length - 1 : selectedIndex - 1;
    }

    if (options[selectedIndex]) {
        playTactileClick();
        options[selectedIndex].classList.add("selected");
        options[selectedIndex].scrollIntoView({ block: "nearest" });
    }
}

const searchInput = $("symbolSearch");
if (searchInput) {
    searchInput.onmouseenter = () => playTactileClick();
    searchInput.onclick = () => playTactileClick();
    searchInput.oninput = (e) => {
        playTactileClick();
        let query = e.target.value;
        const converted = convertCyrillicToLatin(query).toUpperCase();
        // If user typed Cyrillic characters, auto-convert input field value to Latin!
        if (/[а-щьюяїієґыэъё]/i.test(query)) {
            e.target.value = converted;
            query = converted;
        }
        const filtered = filterSymbols(query);
        showDropdown(filtered);
    };

    searchInput.onfocus = (e) => {
        playTactileClick();
        const query = e.target.value;
        const filtered = filterSymbols(query);
        showDropdown(filtered);
    };

    searchInput.onkeydown = (e) => {
        const dropdown = $("symbolDropdown");
        if (!dropdown || !dropdown.classList.contains("show")) return;

        if (e.key === "ArrowDown") {
            e.preventDefault();
            updateSelection("down");
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            updateSelection("up");
        } else if (e.key === "Enter") {
            e.preventDefault();
            const options = dropdown.querySelectorAll(".symbol-option");
            if (selectedIndex >= 0 && selectedIndex < options.length) {
                const sym = options[selectedIndex].querySelector(".symbol-name").textContent;
                window.selectSymbol(sym);
            } else if (options.length > 0) {
                const sym = options[0].querySelector(".symbol-name").textContent;
                window.selectSymbol(sym);
            } else {
                const typed = e.target.value.toUpperCase();
                if (typed) window.selectSymbol(typed);
            }
        } else if (e.key === "Escape") {
            dropdown.classList.remove("show");
        }
    };
}

document.addEventListener("click", (e) => {
    if (!e.target.closest(".symbol-search-wrapper")) {
        const dropdown = $("symbolDropdown");
        if (dropdown) dropdown.classList.remove("show");
    }
});

async function poll() {
    if (!state.isRunning) return;
    try {
        const r = await fetch(`/api/poll?symbol=${state.symbol}&long_ex=${state.longEx}&short_ex=${state.shortEx}`);
        const data = await r.json();
        if (data.ok) {
            if ($("inVal")) $("inVal").textContent = (data.entry_pct >= 0 ? '+' : '') + data.entry_pct.toFixed(4) + "%";
            if ($("outVal")) $("outVal").textContent = (data.exit_pct >= 0 ? '+' : '') + data.exit_pct.toFixed(4) + "%";
            if ($("lat")) $("lat").textContent = data.latency_ms;
            if ($("dot")) $("dot").className = "dot ok";

            if ($("longExName")) $("longExName").textContent = state.longEx;
            if ($("shortExName")) $("shortExName").textContent = state.shortEx;

            const lfr = (data.long_funding !== undefined && data.long_funding !== null) ? data.long_funding : 0.0;
            const sfr = (data.short_funding !== undefined && data.short_funding !== null) ? data.short_funding : 0.0;
            const nfr = (data.net_funding !== undefined) ? data.net_funding : (sfr - lfr);

            if ($("longFundingVal")) {
                $("longFundingVal").textContent = (lfr >= 0 ? "+" : "") + lfr.toFixed(4) + "%";
                $("longFundingVal").style.color = lfr >= 0 ? "var(--green)" : "var(--red)";
            }
            if ($("shortFundingVal")) {
                $("shortFundingVal").textContent = (sfr >= 0 ? "+" : "") + sfr.toFixed(4) + "%";
                $("shortFundingVal").style.color = sfr >= 0 ? "var(--green)" : "var(--red)";
            }
            if ($("netFundingVal")) {
                $("netFundingVal").textContent = (nfr >= 0 ? "+" : "") + nfr.toFixed(4) + "% APR";
                $("netFundingVal").style.color = nfr >= 0 ? "var(--green)" : "var(--red)";
            }

            const t = Math.floor(Date.now() / 1000);
            if (t > lastChartTimestamp) {
                if (inSeries) inSeries.update({ time: t, value: data.entry_pct });
                if (outSeries) outSeries.update({ time: t, value: data.exit_pct });
                lastChartTimestamp = t;
            }

            let shouldPlay = false;
            if (state.entryAlert !== null && data.entry_pct >= state.entryAlert) shouldPlay = true;
            if (state.exitAlert !== null && data.exit_pct >= state.exitAlert) shouldPlay = true;

            if (shouldPlay) playAlertSound();

            if ($("mainTitle")) $("mainTitle").innerHTML = `<b>${state.symbol}</b> | <span class="green">L: ${state.longEx}</span> | <span class="red">S: ${state.shortEx}</span>`;
        } else {
            if ($("dot")) $("dot").className = "dot err";
        }
    } catch (e) {
        if ($("dot")) $("dot").className = "dot err";
    }
}

let pinnedItems = [];
try {
    const raw = localStorage.getItem("pinnedItems");
    if (raw) {
        pinnedItems = JSON.parse(raw);
    } else {
        const oldSyms = JSON.parse(localStorage.getItem("pinnedSymbols") || "[]");
        pinnedItems = oldSyms.map(s => ({ symbol: s, long_ex: "Ondo", short_ex: "RH_Lighter" }));
    }
} catch (e) {
    pinnedItems = [];
}
let enabledExchanges;
try {
    enabledExchanges = JSON.parse(localStorage.getItem("enabledExchanges") || '["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"]');
} catch (e) {
    enabledExchanges = ["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"];
}
if (!Array.isArray(enabledExchanges) || enabledExchanges.length < 2) {
    enabledExchanges = ["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"];
    localStorage.setItem("enabledExchanges", JSON.stringify(enabledExchanges));
}
let scannerSortBy = localStorage.getItem("scannerSortBy") || "spread";

function updateSortHeaderUI() {
    const spreadHeader = $("sortSpread");
    const netAprHeader = $("sortNetApr");
    if (spreadHeader && netAprHeader) {
        if (scannerSortBy === "net_apr") {
            spreadHeader.classList.remove("active");
            spreadHeader.innerHTML = "Spread ↕";
            netAprHeader.classList.add("active");
            netAprHeader.innerHTML = "Net APR 🔽";
        } else {
            spreadHeader.classList.add("active");
            spreadHeader.innerHTML = "Spread 🔽";
            netAprHeader.classList.remove("active");
            netAprHeader.innerHTML = "Net APR ↕";
        }
    }
}

let expandedSymbols = new Set();

window.toggleVariations = (sym, event) => {
    if (event) event.stopPropagation();
    playTactileClick();
    if (expandedSymbols.has(sym)) {
        expandedSymbols.delete(sym);
    } else {
        expandedSymbols.add(sym);
    }
    renderScanItems(lastScanItems);
};

function renderScanItems(rawItems) {
    const body = $("topSpreads") || $("scanBody");
    if (!body) return;

    let itemsMap = {};
    (rawItems || []).forEach(it => {
        itemsMap[it.symbol] = it;
    });

    const pinnedSymbols = pinnedItems.map(p => p.symbol);

    let allSymbols = new Set([
        ...pinnedSymbols,
        ...(rawItems || []).map(it => it.symbol)
    ]);

    let items = Array.from(allSymbols).map(sym => {
        if (itemsMap[sym]) {
            return itemsMap[sym];
        } else {
            const pInfo = pinnedItems.find(p => p.symbol === sym) || {};
            return {
                symbol: sym,
                long_ex: pInfo.long_ex || state.longEx || "Ondo",
                short_ex: pInfo.short_ex || state.shortEx || "RH_Lighter",
                entry_pct: 0.0,
                long_funding: 0.0,
                short_funding: 0.0,
                net_funding: 0.0,
                is_missing: true
            };
        }
    });

    items.sort((a, b) => {
        const aPinned = pinnedSymbols.includes(a.symbol);
        const bPinned = pinnedSymbols.includes(b.symbol);
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;

        if (scannerSortBy === "net_apr") {
            const aNfr = (a.net_funding !== undefined) ? a.net_funding : ((a.short_funding || 0) - (a.long_funding || 0));
            const bNfr = (b.net_funding !== undefined) ? b.net_funding : ((b.short_funding || 0) - (b.long_funding || 0));
            return bNfr - aNfr;
        } else {
            return b.entry_pct - a.entry_pct;
        }
    });

    updateSortHeaderUI();

    body.innerHTML = "";
    items.forEach((it, idx) => {
        const tr = document.createElement("tr");
        const isPinned = pinnedItems.some(p => p.symbol === it.symbol);
        const isExpanded = expandedSymbols.has(it.symbol);
        const isLastPinned = isPinned && (idx === items.length - 1 || !pinnedItems.some(p => p.symbol === items[idx + 1].symbol));
        
        if (isPinned) {
            tr.classList.add("pinned-row");
        }

        const lfr = it.long_funding || 0.0;
        const sfr = it.short_funding || 0.0;
        const nfr = (it.net_funding !== undefined) ? it.net_funding : (sfr - lfr);
        const sepClass = isLastPinned ? 'pin-separator-td' : '';
        const l_ex = it.long_ex || state.longEx;
        const s_ex = it.short_ex || state.shortEx;
        const exTag = it.is_missing 
            ? `<span class="ex-pair-tag" style="opacity:0.6;" title="Монета відсутня у топі спредів">Немає спреду</span>` 
            : `<span class="ex-pair-tag" title="Краща пара: LONG ${l_ex} / SHORT ${s_ex}">${l_ex} ➔ ${s_ex}</span>`;

        const spreadTxt = it.is_missing ? `<span style="color:#848e9c;">--</span>` : `${it.entry_pct.toFixed(3)}%`;
        const fundingTxt = it.is_missing 
            ? `<span style="color:#848e9c;">-- / --</span>` 
            : `<span class="${lfr >= 0 ? 'green' : 'red'}">${lfr >= 0 ? '+' : ''}${lfr.toFixed(2)}%</span> / <span class="${sfr >= 0 ? 'green' : 'red'}">${sfr >= 0 ? '+' : ''}${sfr.toFixed(2)}%</span>`;
        const netFundingTxt = it.is_missing
            ? `<span style="color:#848e9c;">--</span>`
            : `${nfr >= 0 ? '+' : ''}${nfr.toFixed(2)}%`;

        tr.innerHTML = `
            <td class="${sepClass}">
                <button class="btn-pin ${isPinned ? 'pinned' : ''}" onclick="togglePin('${it.symbol}', '${l_ex}', '${s_ex}', event)" title="${isPinned ? 'Відкріпити монету' : 'Закріпити точну пару монети вгорі'}">📌</button>
                <span class="sym-link" onclick="selectSymbol('${it.symbol}', '${l_ex}', '${s_ex}')" title="Клікніть для аналізу монети ${it.symbol}">${it.symbol}</span>
                <button class="btn-expand ${isExpanded ? 'expanded' : ''}" onclick="toggleVariations('${it.symbol}', event)" title="Показати варіації спредів по ${it.symbol}">▾</button>
                ${exTag}
            </td>
            <td class="${sepClass} ${it.is_missing ? '' : (it.entry_pct > 0 ? 'green' : 'red')}">${spreadTxt}</td>
            <td class="${sepClass}" style="font-size:11px; white-space:nowrap;">${fundingTxt}</td>
            <td class="${sepClass} ${it.is_missing ? '' : (nfr >= 0 ? 'green' : 'red')}" style="font-size:11px; font-weight:bold; white-space:nowrap;">${netFundingTxt}</td>
        `;
        body.appendChild(tr);

        const pinBtn = tr.querySelector('.btn-pin');
        if (pinBtn) pinBtn.onmouseenter = () => playTactileClick();

        const symLink = tr.querySelector('.sym-link');
        if (symLink) {
            symLink.onmouseenter = () => playTactileClick();
            symLink.onauxclick = (e) => {
                if (e.button === 1) {
                    playTactileClick();
                    window.openSymbolInNewTab(it.symbol, l_ex, s_ex, e);
                }
            };
            symLink.onmousedown = (e) => {
                if (e.button === 1) e.preventDefault();
            };
        }

        const expandBtn = tr.querySelector('.btn-expand');
        if (expandBtn) expandBtn.onmouseenter = () => playTactileClick();

        // Render accordion row if expanded
        if (isExpanded) {
            const varTr = document.createElement("tr");
            varTr.className = "variations-row";
            const varsList = it.variations || [];
            
            let varsHtml = "";
            if (varsList.length === 0) {
                varsHtml = `<div style="font-size:11px; color:#848e9c; padding:4px;">Немає додаткових варіацій для цієї монети</div>`;
            } else {
                varsHtml = varsList.map(v => {
                    const vNfr = v.net_funding;
                    const isCurrentPair = (v.long_ex === l_ex && v.short_ex === s_ex);
                    return `
                        <div class="var-item" data-sym="${it.symbol}" data-long="${v.long_ex}" data-short="${v.short_ex}" style="${isCurrentPair ? 'background: rgba(55, 115, 245, 0.1); border-left: 2px solid #3773f5;' : ''}">
                            <div class="var-pair">
                                <span style="font-size:10px; color:#94a3b8;">${v.long_ex} ➔ ${v.short_ex}</span>
                                ${isCurrentPair ? '<span style="font-size:9px; background:#3773f5; color:#fff; padding:1px 4px; border-radius:3px;">Активна</span>' : ''}
                            </div>
                            <div class="var-metrics">
                                <span class="${v.entry_pct > 0 ? 'green' : 'red'}" style="font-weight:600;">${v.entry_pct.toFixed(3)}%</span>
                                <span style="font-size:10px; color:#94a3b8;">${v.long_funding.toFixed(2)}% / ${v.short_funding.toFixed(2)}%</span>
                                <span class="${vNfr >= 0 ? 'green' : 'red'}" style="font-weight:bold;">${vNfr >= 0 ? '+' : ''}${vNfr.toFixed(2)}%</span>
                                <button class="var-action-btn" onclick="selectSymbol('${it.symbol}', '${v.long_ex}', '${v.short_ex}')" title="Переглянути на графіку">📊</button>
                            </div>
                        </div>
                    `;
                }).join("");
            }

            varTr.innerHTML = `
                <td colspan="4">
                    <div class="variations-box">
                        <div class="variations-title">
                            <span>🔀 Варіації спредів по ${it.symbol} на інших біржах (клікніть колесиком для нової вкладки):</span>
                        </div>
                        ${varsHtml}
                    </div>
                </td>
            `;
            
            varTr.querySelectorAll('.var-item').forEach(vItem => {
                const vSym = vItem.dataset.sym;
                const vLong = vItem.dataset.long;
                const vShort = vItem.dataset.short;
                if (vSym && vLong && vShort) {
                    vItem.onauxclick = (e) => {
                        if (e.button === 1) {
                            playTactileClick();
                            window.openSymbolInNewTab(vSym, vLong, vShort, e);
                        }
                    };
                    vItem.onmousedown = (e) => {
                        if (e.button === 1) e.preventDefault();
                    };
                }
            });

            body.appendChild(varTr);
        }
    });
}

window.openSymbolInNewTab = (sym, longEx, shortEx, event) => {
    if (event) {
        event.preventDefault();
        event.stopPropagation();
    }
    const targetLong = longEx || state.longEx;
    const targetShort = shortEx || state.shortEx;
    const newUrl = `${window.location.origin}${window.location.pathname}?symbol=${encodeURIComponent(sym)}&long_ex=${encodeURIComponent(targetLong)}&short_ex=${encodeURIComponent(targetShort)}`;
    window.open(newUrl, '_blank');
};

window.selectSymbol = (sym, longEx, shortEx) => {
    state.symbol = sym;
    const searchInput = $("symbolSearch");
    if (searchInput) searchInput.value = sym;
    const dropdown = $("symbolDropdown");
    if (dropdown) dropdown.classList.remove("show");

    if (longEx && $("longEx")) {
        setCustomSelectValue("longEx", longEx);
        state.longEx = longEx;
    }
    if (shortEx && $("shortEx")) {
        setCustomSelectValue("shortEx", shortEx);
        state.shortEx = shortEx;
    }
    updateTradeButtons();
    updateDashboard();
};

window.togglePin = (sym, longEx, shortEx, event) => {
    if (event) event.stopPropagation();
    playTactileClick();
    
    const existingIdx = pinnedItems.findIndex(p => p.symbol === sym);
    if (existingIdx !== -1) {
        pinnedItems.splice(existingIdx, 1);
    } else {
        pinnedItems.push({ symbol: sym, long_ex: longEx || state.longEx, short_ex: shortEx || state.shortEx });
    }
    localStorage.setItem("pinnedItems", JSON.stringify(pinnedItems));
    renderScanItems(lastScanItems);
    scan();
};

async function scan() {
    try {
        const exParam = (enabledExchanges && enabledExchanges.length >= 2) ? enabledExchanges.join(",") : "Ondo,RH_Lighter,Variational";
        const pinParam = JSON.stringify(pinnedItems);
        const r = await fetch(`/api/scan_top?long_ex=${encodeURIComponent(state.longEx)}&short_ex=${encodeURIComponent(state.shortEx)}&exchanges=${encodeURIComponent(exParam)}&min_spread=${state.minSpread}&pinned_pairs=${encodeURIComponent(pinParam)}`);
        const data = await r.json();
        if (data.ok && data.items) {
            lastScanItems = data.items;
            renderScanItems(lastScanItems);
        }
    } catch (e) {
        console.error("Scan error:", e);
    }
}

let lastChartTimestamp = 0;

async function loadChartHistory() {
    if (!inSeries || !outSeries) return;
    try {
        const url = `/api/history?symbol=${encodeURIComponent(state.symbol)}&long_ex=${encodeURIComponent(state.longEx)}&short_ex=${encodeURIComponent(state.shortEx)}&limit=1000`;
        const r = await fetch(url);
        const d = await r.json();
        if (d.ok && d.items && d.items.length > 0) {
            const latest = d.items[0];
            const lfr = latest.long_funding || 0.0;
            const sfr = latest.short_funding || 0.0;
            const nfr = sfr - lfr;

            if ($("longFundingVal")) {
                $("longFundingVal").textContent = (lfr >= 0 ? "+" : "") + lfr.toFixed(4) + "%";
                $("longFundingVal").style.color = lfr >= 0 ? "var(--green)" : "var(--red)";
            }
            if ($("shortFundingVal")) {
                $("shortFundingVal").textContent = (sfr >= 0 ? "+" : "") + sfr.toFixed(4) + "%";
                $("shortFundingVal").style.color = sfr >= 0 ? "var(--green)" : "var(--red)";
            }
            if ($("netFundingVal")) {
                $("netFundingVal").textContent = (nfr >= 0 ? "+" : "") + nfr.toFixed(4) + "% APR";
                $("netFundingVal").style.color = nfr >= 0 ? "var(--green)" : "var(--red)";
            }

            const sorted = d.items.slice().sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
            const inData = [];
            const outData = [];
            let prevTime = 0;

            sorted.forEach(it => {
                const t = Number(it.timestamp);
                if (t > prevTime) {
                    inData.push({ time: t, value: Number(it.entry_pct) });
                    outData.push({ time: t, value: Number(it.exit_pct) });
                    prevTime = t;
                }
            });

            inSeries.setData(inData);
            outSeries.setData(outData);
            lastChartTimestamp = prevTime;

            if (chart) {
                chart.timeScale().fitContent();
            }
        } else {
            inSeries.setData([]);
            outSeries.setData([]);
            lastChartTimestamp = 0;
        }
    } catch (e) {
        console.error("Failed to load chart history", e);
        inSeries.setData([]);
        outSeries.setData([]);
        lastChartTimestamp = 0;
    }
}

function updateDashboard() {
    if ($("longEx")) state.longEx = $("longEx").value;
    if ($("shortEx")) state.shortEx = $("shortEx").value;

    if ($("mainTitle")) $("mainTitle").innerHTML = `<b>${state.symbol}</b> | <span class="green">L: ${state.longEx}</span> | <span class="red">S: ${state.shortEx}</span>`;
    if ($("longExName")) $("longExName").textContent = state.longEx;
    if ($("shortExName")) $("shortExName").textContent = state.shortEx;

    state.isRunning = true;

    if (audioCtx.state === 'suspended') audioCtx.resume();

    loadChartHistory();
    poll();
    scan();
}

const EXCHANGE_NAMES = {
    "Ondo": "Ondo Perps",
    "RH_Lighter": "Robinhood Lighter",
    "Variational": "Variational Omni",
    "Extended": "Extended DEX",
    "Lighter": "Lighter DEX",
    "RiseX": "RiseX",
    "Bullet": "Bullet DEX"
};

const EXCHANGE_ICONS = {
    "Ondo": "/static/images/ondo.png",
    "RH_Lighter": "/static/images/lighter.png",
    "Variational": "/static/images/variational.jpg",
    "Extended": "/static/images/extended.png",
    "Lighter": "/static/images/lighter_dex.png",
    "RiseX": "/static/images/risex.png",
    "Bullet": "/static/images/bullet.png"
};

function getExchangeTradeUrl(ex, symbol) {
    const s = (symbol || "BTC").toUpperCase();
    if (ex === "Ondo") {
        const ondoSym = (s === "SPY" || s === "SP500_INDEX") ? "US500" : s;
        return `https://app.ondoperps.xyz/trade/perps/${ondoSym}-USD.P`;
    } else if (ex === "RH_Lighter" || ex === "Lighter") {
        return `https://app.lighter.xyz/trade/${s}`;
    } else if (ex === "Variational") {
        const vSym = (s === "SPY") ? "US500" : (s === "QQQ" ? "US100" : s);
        return `https://omni.variational.io/perps/${vSym}`;
    } else if (ex === "Extended" || ex === "EXTENDET") {
        return `https://app.extended.exchange/trade/${s}-USD`;
    } else if (ex === "RiseX") {
        return `https://www.rise.trade/en/trade/${s}`;
    } else if (ex === "Bullet") {
        const bSym = (s === "SPY") ? "US500" : s;
        return `https://app.bullet.xyz/trade/${bSym}-USD`;
    }
    return "#";
}

function updateTradeButtons() {
    const longEx = $("longEx") ? $("longEx").value : "Ondo";
    const shortEx = $("shortEx") ? $("shortEx").value : "RH_Lighter";
    const currentSym = state.symbol || "BTC";

    const entryContainer = $("entryTradeBtns");
    const exitContainer = $("exitTradeBtns");

    if (entryContainer) {
        const longUrl = getExchangeTradeUrl(longEx, currentSym);
        const longIcon = EXCHANGE_ICONS[longEx] || "/static/images/ondo.png";
        const longName = EXCHANGE_NAMES[longEx] || longEx;

        entryContainer.innerHTML = `
            <a class="ex-trade-card-btn" href="${longUrl}" target="_blank" title="Перейти на торгівлю ${currentSym} на ${longName}">
                <span class="badge-card-side badge-card-long">LONG</span>
                <img src="${longIcon}" class="big-ex-icon">
                <span class="ex-card-title">${longName} ↗</span>
            </a>
        `;
        const entryBtn = entryContainer.querySelector(".ex-trade-card-btn");
        if (entryBtn) {
            entryBtn.onmouseenter = () => playTactileClick();
            entryBtn.onmousedown = () => playTactileClick();
            entryBtn.onclick = () => playTactileClick();
        }
    }

    if (exitContainer) {
        const shortUrl = getExchangeTradeUrl(shortEx, currentSym);
        const shortIcon = EXCHANGE_ICONS[shortEx] || "/static/images/lighter.png";
        const shortName = EXCHANGE_NAMES[shortEx] || shortEx;

        exitContainer.innerHTML = `
            <a class="ex-trade-card-btn" href="${shortUrl}" target="_blank" title="Перейти на торгівлю ${currentSym} на ${shortName}">
                <span class="badge-card-side badge-card-short">SHORT</span>
                <img src="${shortIcon}" class="big-ex-icon">
                <span class="ex-card-title">${shortName} ↗</span>
            </a>
        `;
        const exitBtn = exitContainer.querySelector(".ex-trade-card-btn");
        if (exitBtn) {
            exitBtn.onmouseenter = () => playTactileClick();
            exitBtn.onmousedown = () => playTactileClick();
            exitBtn.onclick = () => playTactileClick();
        }
    }
}

function setCustomSelectValue(selectId, val) {
    const isLong = selectId === "longEx";
    const textId = isLong ? "longExText" : "shortExText";
    const iconId = isLong ? "longExIcon" : "shortExIcon";
    const dropdownId = isLong ? "longExDropdown" : "shortExDropdown";
    const nativeSelect = $(selectId);
    const textSpan = $(textId);
    const iconImg = $(iconId);
    const dropdown = $(dropdownId);

    if (nativeSelect) nativeSelect.value = val;
    if (isLong) state.longEx = val;
    else state.shortEx = val;

    if (textSpan) textSpan.innerText = EXCHANGE_NAMES[val] || val;
    if (iconImg) iconImg.src = EXCHANGE_ICONS[val] || '';

    if (dropdown) {
        dropdown.querySelectorAll('.custom-dropdown-option').forEach(opt => {
            if (opt.getAttribute('data-value') === val) {
                opt.classList.add('active');
            } else {
                opt.classList.remove('active');
            }
        });
    }
    updateTradeButtons();
}

function initCustomSelects() {
    ['longEx', 'shortEx'].forEach(selectId => {
        const isLong = selectId === "longEx";
        const wrapper = $(isLong ? "longExWrapper" : "shortExWrapper");
        const trigger = $(isLong ? "longExTrigger" : "shortExTrigger");
        const dropdown = $(isLong ? "longExDropdown" : "shortExDropdown");

        if (wrapper && trigger && dropdown) {
            trigger.onmouseenter = () => playTactileClick();

            trigger.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                playTactileClick();

                const wasOpen = wrapper.classList.contains('open');
                document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));

                if (!wasOpen) {
                    wrapper.classList.add('open');
                }
            };

            dropdown.querySelectorAll('.custom-dropdown-option').forEach(opt => {
                opt.onmouseenter = () => playTactileClick();
                opt.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    playTactileClick();

                    const val = opt.getAttribute('data-value');
                    setCustomSelectValue(selectId, val);
                    wrapper.classList.remove('open');
                    updateDashboard();
                };
            });
        }
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.custom-select-wrapper')) {
            document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
        }
    });
}

const swapBtn = $("swapExchanges");
if (swapBtn) {
    swapBtn.onmouseenter = () => playTactileClick();
    swapBtn.onclick = () => {
        playTactileClick();
        const longSel = $("longEx");
        const shortSel = $("shortEx");
        if (longSel && shortSel) {
            const tmpLong = longSel.value;
            const tmpShort = shortSel.value;
            setCustomSelectValue("longEx", tmpShort);
            setCustomSelectValue("shortEx", tmpLong);
            updateDashboard();
        }
    };
}

// Table Sorting Handlers
if ($("sortSpread")) {
    $("sortSpread").onmouseenter = () => playTactileClick();
    $("sortSpread").onclick = () => {
        playTactileClick();
        scannerSortBy = "spread";
        localStorage.setItem("scannerSortBy", "spread");
        renderScanItems(lastScanItems);
    };
}
if ($("sortNetApr")) {
    $("sortNetApr").onmouseenter = () => playTactileClick();
    $("sortNetApr").onclick = () => {
        playTactileClick();
        scannerSortBy = "net_apr";
        localStorage.setItem("scannerSortBy", "net_apr");
        renderScanItems(lastScanItems);
    };
}

// Settings Modal
function updateSettingsModalUI() {
    if ($("exOndo")) $("exOndo").checked = enabledExchanges.includes("Ondo");
    if ($("exRHLighter")) $("exRHLighter").checked = enabledExchanges.includes("RH_Lighter");
    if ($("exVariational")) $("exVariational").checked = enabledExchanges.includes("Variational");
    if ($("exExtended")) $("exExtended").checked = enabledExchanges.includes("Extended");
    if ($("exLighter")) $("exLighter").checked = enabledExchanges.includes("Lighter");
    if ($("exRiseX")) $("exRiseX").checked = enabledExchanges.includes("RiseX");
    if ($("exBullet")) $("exBullet").checked = enabledExchanges.includes("Bullet");
    if ($("minSpreadInput")) $("minSpreadInput").value = state.minSpread;
}

if ($("openSettings")) $("openSettings").onclick = () => {
    updateSettingsModalUI();
    $("modal").style.display = "flex";
};
if ($("closeSettings")) $("closeSettings").onclick = () => $("modal").style.display = "none";
if ($("saveSettings")) $("saveSettings").onclick = () => {
    const rawVal = $("minSpreadInput") ? $("minSpreadInput").value.replace(",", ".") : "-100.0";
    const minVal = parseFloat(rawVal);
    state.minSpread = !isNaN(minVal) ? minVal : -100.0;
    
    const newEx = [];
    if ($("exOndo") && $("exOndo").checked) newEx.push("Ondo");
    if ($("exRHLighter") && $("exRHLighter").checked) newEx.push("RH_Lighter");
    if ($("exVariational") && $("exVariational").checked) newEx.push("Variational");
    if ($("exExtended") && $("exExtended").checked) newEx.push("Extended");
    if ($("exLighter") && $("exLighter").checked) newEx.push("Lighter");
    if ($("exRiseX") && $("exRiseX").checked) newEx.push("RiseX");
    if ($("exBullet") && $("exBullet").checked) newEx.push("Bullet");
    
    if (newEx.length >= 2) {
        enabledExchanges = newEx;
    } else {
        enabledExchanges = ["Ondo", "RH_Lighter", "Variational", "Extended", "Lighter", "RiseX", "Bullet"];
    }
    localStorage.setItem("enabledExchanges", JSON.stringify(enabledExchanges));
    
    $("modal").style.display = "none";
    scan();
};

// History Modal Logic
async function loadHistory() {
    try {
        const symInput = $("historySymbolFilter");
        const sym = symInput ? symInput.value.trim() : "";
        const url = sym ? `/api/history?symbol=${encodeURIComponent(sym)}&limit=50` : `/api/history?limit=50`;
        
        const r = await fetch(url);
        const data = await r.json();
        const body = $("historyTableBody");
        if (!body) return;

        body.innerHTML = "";
        if (!data.ok || !data.items || data.items.length === 0) {
            body.innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 10px; color: #888;">Немає збережених записів</td></tr>`;
            return;
        }

        data.items.forEach(it => {
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid #222";
            tr.innerHTML = `
                <td style="padding: 6px; color: #888;">${it.time_str}</td>
                <td style="padding: 6px;"><b>${it.symbol}</b></td>
                <td style="padding: 6px;">${it.long_ask.toFixed(2)}</td>
                <td style="padding: 6px;">${it.short_bid.toFixed(2)}</td>
                <td style="padding: 6px;" class="${it.entry_pct >= 0 ? 'green' : 'red'}">${it.entry_pct.toFixed(3)}%</td>
            `;
            body.appendChild(tr);
        });
    } catch (e) {
        console.error("Failed to load history", e);
    }
}

if ($("openHistory")) $("openHistory").onclick = () => {
    $("historyModal").style.display = "flex";
    loadHistory();
};
if ($("closeHistory")) $("closeHistory").onclick = () => $("historyModal").style.display = "none";
if ($("refreshHistory")) $("refreshHistory").onclick = () => loadHistory();
if ($("historySymbolFilter")) $("historySymbolFilter").oninput = () => loadHistory();

// Alerts Modal
if ($("openAlerts")) $("openAlerts").onclick = () => $("alertModal").style.display = "flex";
if ($("closeAlerts")) $("closeAlerts").onclick = () => $("alertModal").style.display = "none";
if ($("saveAlerts")) $("saveAlerts").onclick = () => {
    const entryVal = parseFloat($("entryAlertLevel").value);
    const exitVal = parseFloat($("exitAlertLevel").value);
    state.entryAlert = isNaN(entryVal) ? null : entryVal;
    state.exitAlert = isNaN(exitVal) ? null : exitVal;
    $("alertModal").style.display = "none";
    if (audioCtx.state === 'suspended') audioCtx.resume();
};

// Start application
async function start() {
    document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
    initChart();
    initCustomSelects();
    updateTradeButtons();
    scan();
    await loadSymbols();
    await loadChartHistory();

    setInterval(poll, 500);
    setInterval(scan, 10000);
}

// Header buttons hover & click sounds
const openSettingsBtn = $("openSettings");
if (openSettingsBtn) {
    openSettingsBtn.onmouseenter = () => playTactileClick();
    openSettingsBtn.onclick = () => {
        playTactileClick();
        $("modal").style.display = "flex";
    };
}

// Sidebar toggle
const sidebarToggleBtn = $("sidebarToggle");
if (sidebarToggleBtn) {
    sidebarToggleBtn.onmouseenter = () => playTactileClick();
    sidebarToggleBtn.onclick = () => {
        playTactileClick();
        const sidebar = document.querySelector(".sidebar");
        if (sidebar) {
            const isCurrentlyCollapsed = sidebar.classList.contains("collapsed");
            playSwooshSound(isCurrentlyCollapsed);
            sidebar.classList.toggle("collapsed");
            const isCollapsedNow = sidebar.classList.contains("collapsed");
            sidebarToggleBtn.title = isCollapsedNow ? "Показати панель" : "Сховати панель";

            const startTime = performance.now();
            const animateResize = () => {
                if (chart && $("chart")) {
                    chart.resize($("chart").offsetWidth, 400);
                }
                if (performance.now() - startTime < 420) {
                    requestAnimationFrame(animateResize);
                } else if (chart) {
                    chart.timeScale().fitContent();
                }
            };
            requestAnimationFrame(animateResize);
        }
    };
}

start();