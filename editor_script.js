/* 그뭐냐스튜디오 v1.8
 * ---------------------------------------------------------------
 * 핵심 언어 의미론은 표준 인터프리터(gmwonya.js)와 1:1로 맞췄다.
 *  - 모든 값은 int32(2의 보수). +,- 는 |0, * 는 Math.imul, 몫/나머지는 floor.
 *  - 나머지(...): 항상 제수 부호를 따르는 floored mod. 0 나눗셈은 오류.
 *  - 글자 입력(진짜뭐지): 코드포인트 1개 소비, 끝나면 -1(EOF).
 *  - 글자 출력(진짜뭐냐): String.fromCodePoint(범위검사) → 이모지/astral 정상.
 *  - 입력은 "한 번에 받는" 단일 스트림(STDIN). ip 커서로 소비.
 *      뭐지     : 공백 건너뛰고 [-]숫자(scanf식). EOF=0
 *      진짜뭐지  : 건너뛰기 없이 다음 글자. EOF=-1
 *  - 점프(있잖아): pc += expr (그 줄에서는 자동 +1 안 함). 범위 밖 = 정상 종료.
 *
 * 코어(Interp/토크나이저/평가기)는 DOM 비의존이라 Node에서 단위테스트 가능.
 * UI 레이어는 document가 있을 때만 붙는다.
 * =============================================================== */

"use strict";

/* ── int32 헬퍼 ─────────────────────────────────────────────── */
const I32 = (x) => x | 0;

/* ── 토크나이저 (편집기 하이라이트와 공용) ────────────────────────
 * 그+ → num, 거+ → geo 로 분리 토큰화한다. (하이라이트 편의)
 * #... 주석은 IDE 확장(표준 문법엔 없음).                         */
function tokenizeLine(text) {
  const regex = /(#.*)|(그+)|(거+)|(진짜뭐지|진짜뭐냐|뭐더라|뭐지|뭐냐|있잖아)|(아|어)|(\.\.\.|\.\.|\.|,,|,|;;|;|~)/g;
  const tokens = [];
  let lastIdx = 0;
  text.replace(regex, (match, comm, num, geo, cmd, bracket, op, offset) => {
    if (offset > lastIdx) tokens.push({ type: "text", val: text.slice(lastIdx, offset) });
    if (comm) tokens.push({ type: "comment", val: comm });
    else if (num) tokens.push({ type: "num", val: num });
    else if (geo) tokens.push({ type: "geo", val: geo });
    else if (cmd) tokens.push({ type: "cmd", val: cmd });
    else if (bracket) tokens.push({ type: "bracket", val: bracket });
    else if (op) tokens.push({ type: "op", val: op });
    lastIdx = offset + match.length;
    return match;
  });
  if (lastIdx < text.length) tokens.push({ type: "text", val: text.slice(lastIdx) });
  return tokens;
}

const codeToks = (line) =>
  tokenizeLine(line).filter((t) => t.type !== "text" && t.type !== "comment");

const isWs = (c) => c === " " || c === "\t" || c === "\n" || c === "\r";

/* ── 인터프리터 코어 (DOM 비의존) ──────────────────────────────── */
class GmwonyaError extends Error {
  constructor(message, lineNo) {
    super(lineNo != null ? `${lineNo}번째 줄: ${message}` : message);
    this.lineNo = lineNo;
  }
}

class Interp {
  constructor(source, stdin = "") {
    this.lines = source.split("\n");
    this.input = Array.from(stdin); // 코드포인트 배열
    this.ip = 0; // 입력 커서
    this.pc = 0; // 0-기반 줄 인덱스
    this.memory = Object.create(null); // addr → int32 (음수 주소 OK)
    this.halted = false;
    this.steps = 0;
  }

  memGet(addr) {
    const v = this.memory[addr];
    return v === undefined ? 0 : v | 0;
  }
  memSet(addr, val) {
    this.memory[addr] = val | 0; // 저장 시 int32 절단
  }

  /* 입력 스트림 */
  nextInt() {
    const a = this.input;
    while (this.ip < a.length && isWs(a[this.ip])) this.ip++;
    if (this.ip >= a.length) return 0; // EOF
    let s = "";
    if (a[this.ip] === "-") { s += "-"; this.ip++; }
    let started = false;
    while (this.ip < a.length && a[this.ip] >= "0" && a[this.ip] <= "9") {
      s += a[this.ip]; this.ip++; started = true;
    }
    return started ? I32(parseInt(s, 10)) : 0;
  }
  nextChar() {
    if (this.ip >= this.input.length) return -1; // EOF
    return this.input[this.ip++].codePointAt(0);
  }

  /* ── 수식 평가 (재귀 하강, int32) ──────────────────────────────
   * 우선순위: 괄호 > 곱셈류(. .. ...) > 덧셈류(, ,,) > 비교(~ ; ;;)  */
  evalTokens(toks) {
    if (!toks || toks.length === 0) return 0;
    let pos = 0;
    const peek = () => toks[pos];
    const consume = () => toks[pos++];
    const self = this;

    function parseAtom() {
      // 빈 괄호(아어)·아…어거 처리: '어'를 만나면 소비하지 말고 0 반환.
      // 닫는 '어'는 바깥 '아' 핸들러가 명시적으로 소비한다.
      if (peek() && peek().type === "bracket" && peek().val === "어") return 0;

      const t = consume();
      if (!t) return 0;

      if (t.type === "bracket" && t.val === "아") {
        let res = parseExpr();
        if (peek() && peek().type === "bracket" && peek().val === "어") consume();
        else throw new GmwonyaError("닫는 괄호 '어'가 없음", self._line);
        // (확장) 괄호 결과에 대한 후위 역참조: 아…어거
        while (peek() && peek().type === "geo") {
          const g = consume();
          for (let i = 0; i < g.val.length; i++) res = self.memGet(res);
        }
        return res;
      }

      if (t.type === "num") {
        let val = t.val.length; // 리터럴 = 그 개수
        while (peek() && peek().type === "geo") {
          const g = consume();
          for (let i = 0; i < g.val.length; i++) val = self.memGet(val);
        }
        return val;
      }

      // 선행 그 없이 거만 온 경우 등은 0 취급(표준에선 비등장)
      return 0;
    }

    function parseFactor() {
      let node = parseAtom();
      while (peek() && peek().type === "op" && [".", "..", "..."].includes(peek().val)) {
        const op = consume().val, r = parseAtom();
        if (op === ".") node = Math.imul(node, r);
        else if (op === "..") {
          if (r === 0) throw new GmwonyaError("0으로 나눔(몫)", self._line);
          node = I32(Math.floor(node / r));
        } else {
          if (r === 0) throw new GmwonyaError("0으로 나눔(나머지)", self._line);
          node = I32(((node % r) + r) % r); // floored
        }
      }
      return node;
    }

    function parseTerm() {
      let node = parseFactor();
      while (peek() && peek().type === "op" && [",", ",,"].includes(peek().val)) {
        const op = consume().val, r = parseFactor();
        node = op === "," ? I32(node + r) : I32(node - r);
      }
      return node;
    }

    function parseExpr() {
      let node = parseTerm();
      while (peek() && peek().type === "op" && ["~", ";", ";;"].includes(peek().val)) {
        const op = consume().val, r = parseTerm();
        if (op === "~") node = node === r ? 1 : 0;
        else if (op === ";") node = node > r ? 1 : 0;
        else node = node >= r ? 1 : 0;
      }
      return node;
    }

    return parseExpr();
  }

  /* lvalue(저장/입력 대상)의 최종 주소. 뒤쪽 geo를 떼어내고 base 식을 평가한 뒤 (geo-1)회 역참조. */
  resolveAddr(tokens) {
    let geoCount = 0, i = tokens.length - 1;
    while (i >= 0 && tokens[i].type === "geo") { geoCount += tokens[i].val.length; i--; }
    const baseToks = tokens.slice(0, i + 1);
    if (geoCount < 1)
      throw new GmwonyaError("대상은 메모리 항이어야 함 (거가 필요)", this._line);
    let addr = baseToks.length === 0 ? 0 : this.evalTokens(baseToks);
    for (let j = 0; j < geoCount - 1; j++) addr = this.memGet(addr);
    return addr;
  }

  /* 한 줄(문장) 실행. 발생한 입출력은 이벤트 배열로 반환(UI/테스트 공용).
   * 이벤트: {e:'out', s} {e:'outc', s} {e:'readint', addr, val} {e:'readchar', addr, val} */
  step() {
    if (this.halted) return [];
    if (this.pc < 0 || this.pc >= this.lines.length) { this.halted = true; return []; }
    this.steps++;
    const lineNo = this.pc + 1;
    this._line = lineNo;

    const raw = this.lines[this.pc];
    const code = raw.split("#")[0]; // 주석 제거(IDE 확장)
    const toks = codeToks(code);
    const cmdIdx = toks.findIndex((t) => t.type === "cmd");

    // 빈 줄 또는 동사 없는 줄 → 다음 줄로(IDE 관용: 오류 대신 진행)
    if (toks.length === 0 || cmdIdx === -1) {
      this.pc++; this._haltIfOob(); return [];
    }

    const cmd = toks[cmdIdx].val;
    const left = toks.slice(0, cmdIdx);
    const right = toks.slice(cmdIdx + 1);
    const events = [];
    let jumped = false;

    switch (cmd) {
      case "뭐더라":
        this.memSet(this.resolveAddr(left), this.evalTokens(right));
        break;
      case "뭐지": {
        const addr = this.resolveAddr(left);
        const val = this.nextInt();
        this.memSet(addr, val);
        events.push({ e: "readint", addr, val });
        break;
      }
      case "진짜뭐지": {
        const addr = this.resolveAddr(left);
        const val = this.nextChar();
        this.memSet(addr, val);
        events.push({ e: "readchar", addr, val });
        break;
      }
      case "뭐냐": {
        const v = this.evalTokens(left);
        events.push({ e: "out", s: String(v) });
        break;
      }
      case "진짜뭐냐": {
        const cp = this.evalTokens(left);
        if (cp < 0 || cp > 0x10ffff)
          throw new GmwonyaError(`유효하지 않은 코드포인트 ${cp}`, lineNo);
        events.push({ e: "outc", s: String.fromCodePoint(cp) });
        break;
      }
      case "있잖아":
        this.pc += this.evalTokens(left);
        jumped = true;
        break;
      default:
        throw new GmwonyaError(`알 수 없는 동사 ${cmd}`, lineNo);
    }

    if (!jumped) this.pc++;
    this._haltIfOob();
    return events;
  }

  _haltIfOob() {
    if (this.pc < 0 || this.pc >= this.lines.length) this.halted = true;
  }

  /* Node 테스트용: 끝까지 실행하고 출력 문자열을 모은다. */
  runToEnd(maxSteps = 10_000_000) {
    let out = "";
    while (!this.halted) {
      if (this.steps >= maxSteps)
        throw new GmwonyaError(`실행 스텝 한도(${maxSteps}) 초과 — 무한 루프 의심`);
      for (const ev of this.step()) if (ev.e === "out" || ev.e === "outc") out += ev.s;
    }
    return out;
  }
}

/* ── Node에서 import되면 코어만 내보내고 종료 ───────────────────── */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { Interp, tokenizeLine, codeToks, GmwonyaError, I32 };
}

/* =================================================================
 *  여기서부터 UI 레이어 — 브라우저(document)일 때만 동작
 * ================================================================= */
if (typeof document !== "undefined") {
  const MAX_STEPS = 5_000_000;

  const editor = document.getElementById("editor");
  const highlightView = document.getElementById("highlight-view");
  const debugView = document.getElementById("debug-view");
  const consoleElem = document.getElementById("console");
  const memContent = document.getElementById("mem-content");
  const stdinElem = document.getElementById("stdin");
  const stdinStatus = document.getElementById("stdin-status");
  const stepInfo = document.getElementById("step-info");
  const exampleSel = document.getElementById("example-select");

  let interp = null;
  let isDebugMode = false;
  let isRunning = false;
  let currentOutSpan = null;
  let lineEls = [];
  let activeLineIdx = -1;

  /* ── 콘솔 출력 ──────────────────────────────────────────────── */
  function printOut(msg) {
    if (!currentOutSpan) {
      currentOutSpan = document.createElement("span");
      currentOutSpan.className = "c-out";
      consoleElem.appendChild(currentOutSpan);
    }
    currentOutSpan.append(msg);
    consoleElem.scrollTop = consoleElem.scrollHeight;
  }
  function log(msg, cls = "c-info") {
    currentOutSpan = null;
    const div = document.createElement("div");
    div.className = cls;
    div.innerText = msg;
    consoleElem.appendChild(div);
    consoleElem.scrollTop = consoleElem.scrollHeight;
  }

  /* ── 하이라이트 렌더 ─────────────────────────────────────────
   * num+geo(연속) → 하나의 메모리 항 span(data-term)으로 묶어 호버 하이라이트가 동작. */
  function renderTokens(tokens) {
    let html = "";
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.type === "num" && tokens[i + 1] && tokens[i + 1].type === "geo") {
        const g = tokens[i + 1];
        const term = t.val + g.val;
        html += `<span class="tok-mem" data-term="${term}">${esc(term)}</span>`;
        i++; // geo 소비
      } else if (t.type === "geo") {
        html += `<span class="tok-mem" data-term="${t.val}">${esc(t.val)}</span>`;
      } else if (t.type === "num") {
        html += `<span class="tok-num">${esc(t.val)}</span>`;
      } else {
        html += `<span class="tok-${t.type}">${esc(t.val)}</span>`;
      }
    }
    return html;
  }
  const esc = (s) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function updateHighlight() {
    const lines = editor.value.split("\n");
    highlightView.innerHTML = lines
      .map((line) => `<div class="line">${renderTokens(tokenizeLine(line))} </div>`)
      .join("");
    syncScroll();
  }
  function syncScroll() { highlightView.scrollTop = editor.scrollTop; }

  function buildDebugView() {
    const lines = editor.value.split("\n");
    debugView.innerHTML = lines
      .map((line, i) => `<div id="line-${i}" class="line">${renderTokens(tokenizeLine(line))}</div>`)
      .join("");
    lineEls = lines.map((_, i) => document.getElementById(`line-${i}`));
    activeLineIdx = -1;
  }

  function setActiveLine(idx, scroll) {
    if (activeLineIdx >= 0 && lineEls[activeLineIdx]) lineEls[activeLineIdx].classList.remove("active");
    if (idx >= 0 && lineEls[idx]) {
      lineEls[idx].classList.add("active");
      if (scroll) lineEls[idx].scrollIntoView({ behavior: "smooth", block: "center" });
    }
    activeLineIdx = idx;
  }

  /* ── STDIN 커서 표시 ────────────────────────────────────────── */
  function updateStdinStatus() {
    if (!interp) {
      const len = Array.from(stdinElem.value).length;
      stdinStatus.innerHTML = `<span class="dim">대기 중</span> · 총 ${len}자`;
      return;
    }
    const arr = interp.input, ip = interp.ip;
    const winStart = Math.max(0, ip - 12);
    const consumed = esc(arr.slice(winStart, ip).join(""));
    const rest = esc(arr.slice(ip, ip + 24).join(""));
    const head = winStart > 0 ? "…" : "";
    const tail = ip + 24 < arr.length ? "…" : "";
    stdinStatus.innerHTML =
      `${head}<span class="dim">${consumed}</span><span class="caret">‸</span>${rest}${tail}` +
      ` <span class="dim">(${ip}/${arr.length})</span>`;
  }

  /* ── 메모리 덤프 ────────────────────────────────────────────── */
  function updateMemoryView() {
    const mem = interp ? interp.memory : {};
    const rows = Object.keys(mem)
      .map(Number)
      .sort((a, b) => a - b)
      .map((k) => {
        const v = mem[k];
        const chr = v >= 32 && v <= 126 ? ` ('${String.fromCharCode(v)}')` : "";
        const hot = k === lastWrittenAddr ? " mem-hot" : "";
        return `<div class="mem-row${hot}"><span class="mem-k">[${k}번]</span>: ${v}${chr}</div>`;
      })
      .join("");
    memContent.innerHTML = rows || `<div class="dim">(비어 있음)</div>`;
  }
  let lastWrittenAddr = null;

  function updateStepInfo() {
    stepInfo.innerText = interp ? `스텝 ${interp.steps} · PC ${interp.pc + 1}줄` : "스텝 0";
  }

  /* ── 모드 전환 ─────────────────────────────────────────────── */
  // 현재 편집기/STDIN 내용으로 인터프리터를 처음부터 새로 만든다.
  function freshInterp() {
    interp = new Interp(editor.value, stdinElem.value);
    lastWrittenAddr = null;
    currentOutSpan = null;
    consoleElem.innerHTML = "";
    buildDebugView();
    setActiveLine(interp.pc, true);
    updateMemoryView();
    updateStdinStatus();
    updateStepInfo();
    log(">>> 실행 시작 — 입력은 STDIN 패널에서 한 번에 읽습니다.", "c-dim");
  }

  function enterRunMode() {
    isDebugMode = true;
    editor.style.display = "none";
    highlightView.style.display = "none";
    debugView.style.display = "block";
    document.getElementById("btn-step").style.display = "inline-block";
    document.getElementById("btn-mode").innerText = "✏️ 편집 모드 전환";
    document.getElementById("status-text").innerText = "모드: 실행/디버그";
    stdinElem.readOnly = true;
    stdinElem.classList.add("locked");
    freshInterp();
  }

  function exitRunMode() {
    isDebugMode = false;
    editor.style.display = "block";
    highlightView.style.display = "block";
    debugView.style.display = "none";
    document.getElementById("btn-step").style.display = "none";
    document.getElementById("btn-mode").innerText = "⚙️ 실행 모드 전환";
    document.getElementById("status-text").innerText = "모드: 편집 중";
    stdinElem.readOnly = false;
    stdinElem.classList.remove("locked");
    interp = null;
    updateStdinStatus();
    updateStepInfo();
    updateHighlight();
  }

  function toggleMode() {
    if (!isDebugMode) enterRunMode();
    else exitRunMode();
  }

  /* ── 한 스텝 실행 ────────────────────────────────────────────
   * render=false 면 무거운 갱신(메모리덤프/커서/스텝)을 생략 → 전체 실행 시 빠름.
   * 콘솔 출력과 활성줄 토글(스크롤 제외)은 항상 수행. */
  function takeStep(render = true) {
    if (!isDebugMode) enterRunMode();
    else if (!interp || interp.halted) freshInterp(); // 끝난 뒤 다시 누르면 처음부터
    if (!interp) return false;
    let events;
    try {
      events = interp.step();
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      log(`\n[그뭐냐 오류] ${msg}`, "c-err");
      interp.halted = true;
      setActiveLine(-1);
      return false;
    }
    for (const ev of events) {
      if (ev.e === "out" || ev.e === "outc") printOut(ev.s);
      else if (ev.e === "readint") {
        lastWrittenAddr = ev.addr;
        log(`[입력→${ev.addr}번] ${ev.val}${interp.ip >= interp.input.length ? " (EOF=0)" : ""}`, "c-in");
      } else if (ev.e === "readchar") {
        lastWrittenAddr = ev.addr;
        const shown = ev.val === -1 ? "EOF(-1)" : `${ev.val} (${String.fromCodePoint(ev.val)})`;
        log(`[글자입력→${ev.addr}번] ${shown}`, "c-in");
      }
    }
    setActiveLine(interp.halted ? -1 : interp.pc, render); // 스크롤은 render일 때만
    if (render) { updateMemoryView(); updateStdinStatus(); updateStepInfo(); }
    if (interp.halted) { log("\n>>> 프로그램 종료."); return false; }
    return true;
  }

  /* ── 전체 실행 ─────────────────────────────────────────────── */
  async function runAll() {
    const startFromEdit = !isDebugMode;
    if (startFromEdit) enterRunMode();
    else if (!interp || interp.halted) freshInterp(); // 끝난 뒤 ▶ 다시 누르면 처음부터
    if (isRunning) return;
    isRunning = true;
    document.getElementById("btn-run").style.display = "none";
    document.getElementById("btn-stop").style.display = "inline-block";
    document.getElementById("btn-step").disabled = true;

    let alive = true;
    while (isRunning && alive) {
      // 화면 갱신 없이 빠르게 한 묶음 실행
      for (let i = 0; i < 4000 && isRunning; i++) {
        if (interp.steps >= MAX_STEPS) {
          log(`\n>>> 스텝 한도(${MAX_STEPS}) 초과 — 무한 루프로 보고 중단합니다.`, "c-err");
          isRunning = false; alive = false; break;
        }
        alive = takeStep(false);
        if (!alive) break;
      }
      setActiveLine(interp && !interp.halted ? interp.pc : -1, false);
      updateMemoryView();
      updateStdinStatus();
      updateStepInfo();
      await new Promise((r) => setTimeout(r, 0));
    }

    if (isRunning) stopRun(false);
    if (startFromEdit) {
      setTimeout(() => {
        if (isDebugMode) exitRunMode();
        log(">> 편집 모드로 복귀함", "c-dim");
      }, 400);
    }
  }

  function stopRun(isForced = true) {
    isRunning = false;
    document.getElementById("btn-run").style.display = "inline-block";
    document.getElementById("btn-stop").style.display = "none";
    document.getElementById("btn-step").disabled = false;
    if (isForced) log("\n>>> 사용자에 의해 강제 중지됨", "c-err");
  }

  function resetAll() {
    stopRun(false);
    if (isDebugMode) exitRunMode();
    interp = null;
    currentOutSpan = null;
    consoleElem.innerHTML = '<div class="c-info"># 리셋됨</div>';
    updateMemoryView();
    updateStdinStatus();
    updateStepInfo();
    updateHighlight();
  }

  /* ── Ghost Hover: 같은 메모리 항 강조 ──────────────────────────── */
  let currentHoverTerm = null;
  editor.addEventListener("mousemove", (e) => {
    if (isDebugMode) return;
    editor.style.pointerEvents = "none";
    highlightView.style.pointerEvents = "auto";
    const el = document.elementFromPoint(e.clientX, e.clientY);
    highlightView.style.pointerEvents = "none";
    editor.style.pointerEvents = "auto";
    if (el && el.classList.contains("tok-mem")) hoverMem(el.getAttribute("data-term"));
    else clearHover();
  });
  editor.addEventListener("mouseleave", clearHover);
  function hoverMem(term) {
    if (currentHoverTerm === term) return;
    clearHover();
    currentHoverTerm = term;
    document.querySelectorAll(`.tok-mem[data-term="${CSS.escape(term)}"]`).forEach((el) => el.classList.add("highlight"));
  }
  function clearHover() {
    if (currentHoverTerm === null) return;
    document.querySelectorAll(".tok-mem.highlight").forEach((el) => el.classList.remove("highlight"));
    currentHoverTerm = null;
  }

  /* ── 예제 ──────────────────────────────────────────────────── */
  const EXAMPLES = {
    sum: {
      label: "두 수의 합",
      stdin: "3 5",
      code: ["그거 뭐지", "그그거 뭐지", "그거,그그거 뭐냐"].join("\n"),
    },
    fib: {
      label: "n번째 피보나치",
      stdin: "20",
      code: [
        "그거 뭐지",
        "그그그그거 뭐더라 그",
        "그그그그그거 뭐더라 그",
        "그그거 뭐더라 그그거,그",
        "아 그그;;그그거 어 . 그그그 , 그 있잖아",
        "그그그거 뭐더라 그그그그거",
        "그그그그거 뭐더라 그그그그그거",
        "그그그그그거 뭐더라 그그그거,그그그그거",
        "아 그거;그그거 어 . 아 그,,그그그그그그그 어 , 그 있잖아",
        "그그그그그거 뭐냐",
      ].join("\n"),
    },
    sort: {
      label: "버블 정렬",
      stdin: "5 5 2 8 1 9",
      code: [
        "그거 뭐지",
        "그그거 뭐더라 그,,그",
        "아 그그거 ;; 그거 어 . 그그그그 , 그 있잖아",
        "그그그그그거 뭐더라 그그그그그그그그그그 , 그그거",
        "그그그그그거거 뭐지",
        "그그거 뭐더라 그그거 , 그",
        "그,,그그그그그 있잖아",
        "그그거 뭐더라 그,,그",
        "아 그그거 ;; 아 그거 ,, 그 어 어 . 그그그그그그그그그그그그 , 그 있잖아",
        "그그그거 뭐더라 그,,그",
        "아 그그그거 ;; 아 아 그거 ,, 그 어 ,, 그그거 어 어 . 그그그그그그그그 , 그 있잖아",
        "그그그그그거 뭐더라 그그그그그그그그그그 , 그그그거",
        "그그그그그그거 뭐더라 아 그그그그그그그그그그 , 그 어 , 그그그거",
        "아 아 그그그그그거거 ; 그그그그그그거거 어 ~ 그,,그 어 . 그그그 , 그 있잖아",
        "그그그그거 뭐더라 그그그그그거거",
        "그그그그그거거 뭐더라 그그그그그그거거",
        "그그그그그그거거 뭐더라 그그그그거",
        "그그그거 뭐더라 그그그거 , 그",
        "그,,그그그그그그그그그 있잖아",
        "그그거 뭐더라 그그거 , 그",
        "그,,그그그그그그그그그그그그그 있잖아",
        "그그거 뭐더라 그,,그",
        "아 그그거 ;; 그거 어 . 그그그그그, 그 있잖아",
        "그그그그그거 뭐더라 그그그그그그그그그그 , 그그거",
        "그그그그그거거 뭐냐",
        "그그그그 . 아 그그그그 , 그그그그 어 진짜뭐냐",
        "그그거 뭐더라 그그거 , 그",
        "그,,그그그그그그 있잖아",
      ].join("\n"),
    },
    echo: {
      label: "유니코드 에코(이모지 OK)",
      stdin: "안녕 그뭐냐 🌟",
      code: [
        "그거 진짜뭐지",
        "아 그거 ~ 그,,그그 어 . 그그 , 그 있잖아",
        "그거 진짜뭐냐",
        "그,,그그그그 있잖아",
      ].join("\n"),
    },
  };

  function loadExample() {
    const key = exampleSel.value;
    if (!key || !EXAMPLES[key]) return;
    if (isDebugMode) exitRunMode();
    editor.value = EXAMPLES[key].code;
    stdinElem.value = EXAMPLES[key].stdin;
    updateHighlight();
    updateStdinStatus();
    log(`# 예제 불러옴: ${EXAMPLES[key].label}`, "c-dim");
    exampleSel.value = "";
  }

  /* ── 이벤트 바인딩 (HTML의 onclick 제거하고 여기서 연결) ─────────── */
  editor.addEventListener("input", updateHighlight);
  editor.addEventListener("scroll", syncScroll);
  stdinElem.addEventListener("input", updateStdinStatus);
  document.getElementById("btn-mode").addEventListener("click", toggleMode);
  document.getElementById("btn-step").addEventListener("click", () => takeStep(true));
  document.getElementById("btn-run").addEventListener("click", runAll);
  document.getElementById("btn-stop").addEventListener("click", () => stopRun(true));
  document.getElementById("btn-reset").addEventListener("click", resetAll);
  exampleSel.addEventListener("change", loadExample);

  window.addEventListener("beforeunload", (e) => {
    if (editor.value.trim() !== "") { e.preventDefault(); e.returnValue = ""; }
  });

  /* ── 초기 상태 ─────────────────────────────────────────────── */
  editor.value = EXAMPLES.sum.code;
  stdinElem.value = EXAMPLES.sum.stdin;
  updateHighlight();
  updateStdinStatus();
  updateStepInfo();
  log("# 준비 완료 — 예제를 고르거나 코드를 입력한 뒤 ▶ 전체 실행");
}
