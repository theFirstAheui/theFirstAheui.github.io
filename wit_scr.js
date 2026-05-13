
let memory = {};
let pc = 0;
let isDebugMode = false;
let currentOutSpan = null; // 줄바꿈 없는 출력을 위한 변수
let isRunning = false;

const editor = document.getElementById('editor');
const highlightView = document.getElementById('highlight-view');
const debugView = document.getElementById('debug-view');
const consoleElem = document.getElementById('console');
const memContent = document.getElementById('mem-content');

// --- 출력 및 시스템 로그 컨트롤 ---
function printOut(msg) {
    if (!currentOutSpan) {
        currentOutSpan = document.createElement('span');
        currentOutSpan.style.color = "#f1fa8c"; // 노란색 (표준 출력)
        consoleElem.appendChild(currentOutSpan);
    }
    currentOutSpan.innerText += msg;
    consoleElem.scrollTop = consoleElem.scrollHeight;
}

function log(msg, color="#50fa7b") {
    currentOutSpan = null; // 다음 출력 시 새로운 span 생성 유도
    const div = document.createElement('div');
    div.style.color = color;
    div.innerText = msg;
    consoleElem.appendChild(div);
    consoleElem.scrollTop = consoleElem.scrollHeight;
}

// --- 주소 해결기 (Pointer Logic) ---
function resolveAddr(memStr) {
    let geuCount = (memStr.match(/그/g) || []).length;
    let geoCount = (memStr.match(/거/g) || []).length;
    
    let addr = geuCount;
    for (let i = 0; i < geoCount - 1; i++) {
        addr = memory[addr] || 0;
    }
    return addr;
}

// --- Ghost Hover 로직 ---
editor.addEventListener('mousemove', (e) => {
    if (isDebugMode) return;
    editor.style.pointerEvents = 'none';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    editor.style.pointerEvents = 'auto';

    if (el && el.classList.contains('tok-mem')) hoverMem(el.getAttribute('data-addr'));
    else clearHover();
});

function hoverMem(addr) { document.querySelectorAll(`.tok-mem[data-addr="${addr}"]`).forEach(el => el.classList.add('highlight')); }
function clearHover() { document.querySelectorAll('.tok-mem.highlight').forEach(el => el.classList.remove('highlight')); }

// --- 토큰 및 렌더링 ---
function tokenizeLine(text) {
    // 정규식에 '진짜뭐지', '진짜뭐냐' 우선순위 반영
    const regex = /(#.*)|(그+거+)|(그+)|(진짜뭐지|진짜뭐냐|뭐더라|뭐지|뭐냐|있잖아)|(아|어)|(\.\.\.|\.\.|\.|,,|,|;;|;|~)/g;
    let tokens = [];
    let lastIdx = 0;
    
    text.replace(regex, (match, comm, mem, num, cmd, bracket, op, offset) => {
        if (offset > lastIdx) tokens.push({ type: 'text', val: text.slice(lastIdx, offset) });
        if (comm) tokens.push({ type: 'comment', val: comm });
        else if (mem) tokens.push({ type: 'mem', val: mem, addr: resolveAddr(mem) });
        else if (num) tokens.push({ type: 'num', val: num });
        else if (cmd) tokens.push({ type: 'cmd', val: cmd });
        else if (bracket) tokens.push({ type: 'bracket', val: bracket });
        else if (op) tokens.push({ type: 'op', val: op });
        lastIdx = offset + match.length;
    });
    if (lastIdx < text.length) tokens.push({ type: 'text', val: text.slice(lastIdx) });
    return tokens;
}

function renderTokens(tokens) {
    return tokens.map(t => {
        if (t.type === 'mem') return `<span class="tok-mem" data-addr="${t.addr}" title="주소: ${t.addr}번">${t.val}</span>`;
        return `<span class="tok-${t.type}">${t.val}</span>`;
    }).join('');
}

function updateHighlight() {
    const lines = editor.value.split('\n');
    highlightView.innerHTML = lines.map(line => `<div class="line">${renderTokens(tokenizeLine(line))} </div>`).join('');
    if(isDebugMode) {
        debugView.innerHTML = lines.map((line, i) => `<div id="line-${i}" class="line">${renderTokens(tokenizeLine(line))}</div>`).join('');
        if(document.getElementById(`line-${pc}`)) document.getElementById(`line-${pc}`).classList.add('active');
    }
    syncScroll();
}

function syncScroll() { highlightView.scrollTop = editor.scrollTop; }

function toggleMode() {
    if (!isDebugMode) {
        isDebugMode = true;
        updateHighlight();
        editor.style.display = 'none'; highlightView.style.display = 'none'; debugView.style.display = 'block';
        document.getElementById('btn-step').style.display = 'inline-block';
        document.getElementById('btn-mode').innerText = '✏️ 편집 모드 전환';
        document.getElementById('status-text').innerText = '모드: 실행/디버그';
        pc = 0; memory = {}; consoleElem.innerHTML = ""; currentOutSpan = null;
        updateMemoryView(); 
        log(">> 실행 모드 진입","#d8d8d8")
        log(">>> 실행 시작");
    } else {
        isDebugMode = false;
        editor.style.display = 'block'; highlightView.style.display = 'block'; debugView.style.display = 'none';
        document.getElementById('btn-step').style.display = 'none';
        document.getElementById('btn-mode').innerText = '⚙️ 실행 모드 전환';
        document.getElementById('status-text').innerText = '모드: 편집 중';
    }
}

// --- 수식 파서 ---
function getVal(expr) {
    const toks = tokenizeLine(expr).filter(t => t.type !== 'text' && t.type !== 'comment');
    if (toks.length === 0) return 0;
    let pos = 0;
    const consume = () => toks[pos++];
    const peek = () => toks[pos];
    
    function parseAtom() {
        let t = consume(); if (!t) return 0;
        if (t.type === 'bracket' && t.val === '아') { let res = parseExpr(); consume(); return res; }
        if (t.type === 'mem') return memory[resolveAddr(t.val)] || 0;
        if (t.type === 'num') return t.val.length;
        return 0;
    }
    function parseFactor() {
        let node = parseAtom();
        while(peek() && peek().type === 'op' && ['.','..','...'].includes(peek().val)) {
            let op = consume().val; let right = parseAtom();
            if (op === '.') node *= right; else if (op === '..') node = Math.floor(node/right); else node %= right;
        }
        return node;
    }
    function parseTerm() {
        let node = parseFactor();
        while(peek() && peek().type === 'op' && [',',',,'].includes(peek().val)) {
            let op = consume().val; let right = parseFactor();
            if (op === ',') node += right; else node -= right;
        }
        return node;
    }
    function parseExpr() {
        let node = parseTerm();
        while(peek() && peek().type === 'op' && ['~',';',';;'].includes(peek().val)) {
            let op = consume().val; let right = parseTerm();
            if (op === '~') node = node === right ? 1 : 0; else if (op === ';') node = node > right ? 1 : 0; else if (op === ';;') node = node >= right ? 1 : 0;
        }
        return node;
    }
    return parseExpr();
}

// --- 실행 로직 ---
async function takeStep() {
    if (!isDebugMode) toggleMode();
    document.querySelectorAll('.line.active').forEach(el => el.classList.remove('active'));
    let linesArr = editor.value.split('\n');
    if (pc < 0 || pc >= linesArr.length) { log("\n>>> 프로그램 종료."); return false; }
    
    const lineEl = document.getElementById(`line-${pc}`);
    if (lineEl) { lineEl.classList.add('active'); lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    
    let fullLine = linesArr[pc].split('#')[0].trim();
    let jumped = false;
    
    if (fullLine) {
        try {
            if (fullLine.includes("뭐더라")) { 
                let [m, e] = fullLine.split("뭐더라"); 
                let targetAddr = resolveAddr(m.trim());
                memory[targetAddr] = getVal(e.trim()); 
            }
            else if (fullLine.includes("진짜뭐지")) { 
                // 문자 1개를 입력받아 ASCII/유니코드 저장
                let m = fullLine.replace("진짜뭐지", "").trim(); 
                let targetAddr = resolveAddr(m);
                let val = prompt(`[${targetAddr}번] 문자 입력 (한 글자):`); 
                memory[targetAddr] = (val && val.length > 0) ? val.charCodeAt(0) : 0; 
            }
            else if (fullLine.includes("진짜뭐냐")) { 
                // 값을 문자로 변환하여 줄바꿈 없이 출력
                printOut(String.fromCharCode(getVal(fullLine.replace("진짜뭐냐", "")))); 
            }
            else if (fullLine.includes("뭐지")) { 
                let m = fullLine.replace("뭐지", "").trim(); 
                let targetAddr = resolveAddr(m);
                let val = prompt(`[${targetAddr}번] 숫자 입력:`); 
                memory[targetAddr] = parseInt(val) || 0; 
            }
            else if (fullLine.includes("뭐냐")) { 
                // 값을 줄바꿈 없이 출력
                printOut(getVal(fullLine.replace("뭐냐", ""))); 
            }
            else if (fullLine.includes("있잖아")) { 
                let offset = getVal(fullLine.replace("있잖아", "")); 
                pc += offset; jumped = true; 
            }
        } catch (err) { log(`\nError: ${err}`, "#ff5555"); }
    }
    
    if (!jumped) pc++;
    updateMemoryView();
    updateHighlight();
    return true;
}

async function runAll() { 

    let startFromEditMode = !isDebugMode;

    if(!isDebugMode) toggleMode(); 
    if(isRunning) return; // 이미 실행 중이면 중복 실행 방지
    
    isRunning = true;
    let stepCount = 0;
    
    // UI 버튼 상태 변경
    document.getElementById('btn-run').style.display = 'none';
    document.getElementById('btn-stop').style.display = 'inline-block';
    document.getElementById('btn-step').disabled = true;

    // isRunning이 true인 동안만 루프 실행
    while(isRunning && await takeStep()) {
        stepCount++;
        
        // 50번의 명령어마다 브라우저에게 0밀리초 휴식을 주어 화면 렌더링 및 버튼 클릭을 허용함
        if(stepCount % 50 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    // 정상 종료 시 상태 복구
    if(isRunning) stopRun(false);

    // 편집 모드에서 진입했을시 다시 편집 모드로 복귀
    if (startFromEditMode) {
        setTimeout(()=>{
            if (isDebugMode) toggleMode();
            log(">> 편집 모드로 복귀함","#d8d8d8")
        },300);
    }
}

function stopRun(isForced = true) {
    isRunning = false;
    document.getElementById('btn-run').style.display = 'inline-block';
    document.getElementById('btn-stop').style.display = 'none';
    document.getElementById('btn-step').disabled = false;
    if(isForced) log("\n>>> 사용자에 의해 강제 중지됨", "#ff5555");
}

function resetAll() { 
    stopRun(false); // 실행 중이었다면 멈춤
    memory = {}; 
    pc = 0; 
    currentOutSpan = null; 
    consoleElem.innerHTML = "# 리셋됨"; 
    updateMemoryView(); 
    if(isDebugMode) toggleMode(); 
    updateHighlight(); 
}

function updateMemoryView() { 
    memContent.innerHTML = Object.entries(memory).sort((a,b)=>a[0]-b[0])
        .map(([k, v]) => {
            let chrPreview = (v >= 32 && v <= 126) ? ` ('${String.fromCharCode(v)}')` : '';
            return `<div><span style="color:var(--mem)">[${k}번]</span>: ${v}${chrPreview}</div>`;
        }).join(''); 
}

// 신규 예제 코드
editor.value = "";
updateHighlight();
log("# 준비 완료");