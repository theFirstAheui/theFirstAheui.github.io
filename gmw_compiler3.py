import sys
import re
import os
import subprocess

def tokenize(text):
    regex = r'(#.*)|(그+)|(거+)|(진짜뭐지|진짜뭐냐|뭐더라|뭐지|뭐냐|있잖아)|(아|어)|(\.\.\.|\.\.|\.|,,|,|;;|;|~)'
    tokens = []
    for match in re.finditer(regex, text):
        comm, num, geo, cmd, bracket, op = match.groups()
        if comm: tokens.append(('comment', comm))
        elif num: tokens.append(('num', num))
        elif geo: tokens.append(('geo', geo))
        elif cmd: tokens.append(('cmd', cmd))
        elif bracket: tokens.append(('bracket', bracket))
        elif op: tokens.append(('op', op))
    return tokens

class Parser:
    def __init__(self, tokens):
        self.toks = tokens
        self.pos = 0

    def consume(self):
        if self.pos < len(self.toks):
            t = self.toks[self.pos]
            self.pos += 1
            return t
        return None

    def peek(self):
        if self.pos < len(self.toks):
            return self.toks[self.pos]
        return None

    def parse_atom(self):
        t = self.consume()
        if not t: return "0"
        res = "0"
        if t[0] == 'bracket' and t[1] == '아':
            res = f"({self.parse_expr()})"
            self.consume() # consume '어'
            while self.peek() and self.peek()[0] == 'geo':
                geo_tok = self.consume()
                for _ in range(len(geo_tok[1])):
                    res = f"M({res})"
            return res
            
        if t[0] == 'num':
            res = str(len(t[1]))
            while self.peek() and self.peek()[0] == 'geo':
                geo_tok = self.consume()
                for _ in range(len(geo_tok[1])):
                    res = f"M({res})"
            return res
        return "0"

    def parse_factor(self):
        node = self.parse_atom()
        while self.peek() and self.peek()[0] == 'op' and self.peek()[1] in ['.', '..', '...']:
            op_val = self.consume()[1]
            right = self.parse_atom()
            if op_val == '.': node = f"({node} * {right})"
            elif op_val == '..': node = f"({node} / {right})"
            elif op_val == '...': node = f"({node} % {right})"
        return node

    def parse_term(self):
        node = self.parse_factor()
        while self.peek() and self.peek()[0] == 'op' and self.peek()[1] in [',', ',,']:
            op_val = self.consume()[1]
            right = self.parse_factor()
            if op_val == ',': node = f"({node} + {right})"
            elif op_val == ',,': node = f"({node} - {right})"
        return node

    def parse_expr(self):
        node = self.parse_term()
        while self.peek() and self.peek()[0] == 'op' and self.peek()[1] in ['~', ';', ';;']:
            op_val = self.consume()[1]
            right = self.parse_term()
            if op_val == '~': node = f"({node} == {right} ? 1 : 0)"
            elif op_val == ';': node = f"({node} > {right} ? 1 : 0)"
            elif op_val == ';;': node = f"({node} >= {right} ? 1 : 0)"
        return node

def get_val_expr(tokens):
    if not tokens: return "0"
    return Parser(tokens).parse_expr()

def get_addr_expr(tokens):
    if not tokens: return "0"
    geo_count = 0
    i = len(tokens) - 1
    while i >= 0 and tokens[i][0] == 'geo':
        geo_count += len(tokens[i][1])
        i -= 1
    expr_toks = tokens[:i+1]
    addr = get_val_expr(expr_toks)
    for _ in range(geo_count - 1):
        addr = f"M({addr})"
    return addr

def compile_code(source_code):
    lines = source_code.split('\n')
    num_lines = len(lines)
    
    # GCC 확장인 Computed Goto를 위한 점프 테이블 생성
    jump_table_str = "    static void *jump_table[] = {\n        "
    jump_table_str += ", ".join([f"&&line_{i}" for i in range(num_lines)])
    if num_lines > 0:
        jump_table_str += ", "
    jump_table_str += "&&line_end\n    };"

    c_code = [
        "/* 이 코드는 그뭐냐(Gmw) 최적화 컴파일러에 의해 자동 생성되었습니다. */",
        "#include <stdio.h>",
        "#include <stdlib.h>",
        "#define MEM_HALF 1000000",
        "#define MEM_SIZE (MEM_HALF * 2 + 1)",
        "long long memory[MEM_SIZE] = {0};",
        "#define M(addr) memory[(((addr) % (MEM_HALF + 1)) + MEM_HALF)]",
        "",
        "int main() {",
        "    int pc = 0;",
        jump_table_str,
        ""
    ]
    
    for i, line in enumerate(lines):
        line = line.split('#')[0].strip()
        c_code.append(f"    line_{i}:")
        if not line:
            continue
            
        tokens = tokenize(line)
        cmd_idx = -1
        for j, t in enumerate(tokens):
            if t[0] == 'cmd':
                cmd_idx = j
                break
                
        if cmd_idx != -1:
            cmd_val = tokens[cmd_idx][1]
            left_toks = tokens[:cmd_idx]
            right_toks = tokens[cmd_idx+1:]
            
            left_val_expr = get_val_expr(left_toks)
            right_val_expr = get_val_expr(right_toks)
            left_addr_expr = get_addr_expr(left_toks)
            
            if cmd_val == '뭐더라':
                c_code.append(f"        M({left_addr_expr}) = {right_val_expr};")
            elif cmd_val == '진짜뭐지':
                c_code.append(f"        M({left_addr_expr}) = getchar();")
            elif cmd_val == '진짜뭐냐':
                c_code.append(f"        putchar({left_val_expr});")
            elif cmd_val == '뭐지':
                c_code.append(f'        scanf("%lld", &M({left_addr_expr}));')
            elif cmd_val == '뭐냐':
                c_code.append(f'        printf("%lld", {left_val_expr});')
            elif cmd_val == '있잖아':
                # 점프 시에만 pc 계산 및 동적 goto 실행
                c_code.append(f"        pc = {i} + ({left_val_expr});")
                c_code.append(f"        if (pc < 0 || pc >= {num_lines}) goto line_end;")
                c_code.append(f"        goto *jump_table[pc];")
        
    c_code.extend([
        "    line_end:",
        "        return 0;",
        "}"
    ])
    return '\n'.join(c_code)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python gmw_compiler.py [파일명.gmw]")
        sys.exit(1)
        
    in_file = sys.argv[1]
    out_c = in_file.rsplit('.', 1)[0] + '.c'
    out_exe = out_c.replace('.c', '.exe' if os.name == 'nt' else '')
    
    with open(in_file, 'r', encoding='utf-8') as f:
        source = f.read()
        
    c_code = compile_code(source)
    
    with open(out_c, 'w', encoding='utf-8') as f:
        f.write(c_code)
        
    print(f"[*] 고성능 C 코드로 변환 완료: {out_c}")
    print("[*] gcc로 최적화 컴파일을 시도합니다...")
    
    try:
        subprocess.run(["gcc", out_c, "-o", out_exe, "-O3"], check=True)
        print(f"[+] 컴파일 성공! 고속 실행 파일: {out_exe}")
    except FileNotFoundError:
        print("[-] 경고: 시스템에 'gcc'가 설치되어 있지 않습니다.")
        print(f"[-] 변환된 C 소스코드({out_c})를 C 컴파일러로 직접 컴파일해주세요.")
    except subprocess.CalledProcessError:
        print("[-] 컴파일 중 에러가 발생했습니다.")
