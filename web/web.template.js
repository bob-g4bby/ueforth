// Copyright 2021 Bradley D. Nelson
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

'use strict';

(function() {

const HEAP_SIZE = (1024 * 1024);
const STACK_CELLS = 4096;
const VOCABULARY_DEPTH = 16;

const IMMEDIATE = 1;
const SMUDGE = 2;
const BUILTIN_FORK = 4;
const BUILTIN_MARK = 8;

{{boot}}

var heap = new ArrayBuffer(HEAP_SIZE);
var i32 = new Int32Array(heap);
var u16 = new Uint16Array(heap);
var u8 = new Uint8Array(heap);
var builtins = [];
var objects = [SetEval];

{{sys}}

function SetEval(sp) {
  var index = i32[sp--];
  var len = i32[sp--];
  var code_addr = i32[sp--];
  var code = '';
  for (var i = 0; i < len; ++i) {
    code += String.fromCharCode(u8[name_addr + i]);
  }
  objects[index] = eval(code);
}

function Call(sp, tos) {
  return objects[tos](sp);
}

function Load(addr, content) {
  for (var i = 0; i < content.length; ++i) {
    u8[addr++] = content.charCodeAt(i);
  }
  return addr;
}

function UPPER(a) {
  // a = 97, z = 122
  return a >= 97 && a <= 122 ? a & 95 : a;
}

function Same(a, b) {
  if (a.length != b.length) {
    return false;
  }
  for (var i = 0; i < a.length; ++i) {
    if (UPPER(a.charCodeAt(i)) != UPPER(b.charCodeAt(i))) {
      return false;
    }
  }
  return true;
}

function GetString(a, n) {
  var ret = '';
  for (var i = 0; i < n; ++i) {
    ret += String.fromCharCode(u8[a + i]);
  }
  return ret;
}


function CELL_ALIGNED(n) { return (n + 3) & ~3; }

function TOFLAGS(xt) { return xt - 4; }
function TONAMELEN(xt) { return xt + 1; }
function TOPARAMS(xt) { return TOFLAGS(xt) + 2; }
function TOSIZE(xt) { return CELL_ALIGNED(u8[TONAMELEN(xt)>>2]) + 4 * i32[TOPARAMS(xt)>>2]; }
function TOLINK(xt) { return xt - 2; }
function TONAME(xt) {
  return (i32[TOFLAGS(xt)] & BUILTIN_MARK)
    ? u8[TOLINK(xt)] : TOLINK(xt) - CELL_ALIGNED(u8[TONAMELEN(xt)]);
}
function TOBODY(xt) {
  return xt + (i32[xt>>2] === OP_DOCREATE || i32[xt>>2] === OP_DODOES ? 2 : 1);
}

function BUILTIN_ITEM(i) {
  return i32[g_sys_builtins>>2] + 4 * 3 * i;
}
function BUILTIN_NAME(i) {
  return i32[(BUILTIN_ITEM(i) + 0 * 4)>>2];
}
function BUILTIN_FLAGS(i) {
  return u8[BUILTIN_ITEM(i) + 1 * 4 + 0];
}
function BUILTIN_NAMELEN(i) {
  return i32[BUILTIN_ITEM(i) + 1 * 4 + 1];
}
function BUILTIN_VOCAB(i) {
  return u16[(BUILTIN_ITEM(i) + 1 * 4 + 2)>>1];
}
function BUILTIN_CODE(i) {
  return BUILTIN_ITEM(i) + 2 * 4;
}

function Find(name) {
  for (var voc = i32[g_sys_context>>2]; i32[voc>>2]; voc += 4) {
    var xt = i32[i32[voc>>2]>>2];
    while (xt) {
      if (u8[TOFLAGS(xt)] & BUILTIN_FORK) {
        var vocab = i32[(TOLINK(xt) + 4 * 3)>>2];
        for (var i = 0; BUILTIN_NAME(i); ++i) {
          if (BUILTIN_VOCAB(i) === vocab &&
              name.length === BUILTIN_NAMELEN(i) &&
              name === GetString(BUILTIN_NAME(i), name.length)) {
            return BUILTIN_CODE(i);
          }
        }
      }
      if (!(u8[TOFLAGS(xt)] & SMUDGE) &&
          name.length === u8[TONAMELEN(xt)] &&
          name === GetString(TONAME(xt), name.length)) {
        return xt;
      }
      xt = i32[TOLINK(xt)>>2];
    }
  }
  return 0;
}

function COMMA(value) {
  i32[i32[g_sys_heap>>2]>>2] = value;
  i32[g_sys_heap>>2] += 4;
}

function CCOMMA(value) {
  u8[i32[g_sys_heap>>2]>>2] = value;
  i32[g_sys_heap>>2]++;
}

function Finish() {
  // TODO
}

function Create(name, flags, op) {
  Finish();
  i32[g_sys_heap>>2] = CELL_ALIGNED(i32[g_sys_heap>>2]);
  i32[g_sys_heap>>2] = Load(i32[g_sys_heap>>2], name);  // name
  i32[g_sys_heap>>2] = CELL_ALIGNED(i32[g_sys_heap>>2]);
  COMMA(i32[i32[g_sys_current>>2]>>2]);  // link
  COMMA((name.length << 8) | flags);  // flags & length
  i32[i32[g_sys_current>>2]>>2] = i32[g_sys_heap>>2];
  i32[g_sys_latestxt>>2] = i32[g_sys_heap>>2];
  COMMA(op);
}

function Builtin(name, flags, vocab, opcode) {
  builtins.push([name, flags | BUILTIN_MARK, vocab, opcode]);
}

function SetupBuiltins() {
  for (var i = 0; i < builtins.length; ++i) {
    var name = builtins[i][0];
    builtins[i][0] = i32[g_sys_heap>>2];
    i32[g_sys_heap>>2] = Load(i32[g_sys_heap>>2], name);  // name
    i32[g_sys_heap>>2] = CELL_ALIGNED(i32[g_sys_heap>>2]);
    builtins[i][1] |= (name.length << 8);
  }
  i32[g_sys_builtins>>2] = i32[g_sys_heap>>2];
  for (var i = 0; i < builtins.length; ++i) {
    COMMA(builtins[i][0]);
    COMMA(builtins[i][1] | (builtins[i][2] << 16));
    COMMA(builtins[i][3]);
  }
  COMMA(0);
  COMMA(0);
  COMMA(0);
}

function InitDictionary() {
{{dict}}
  SetupBuiltins();
}

function Init() {
  i32[g_sys_heap_start>>2] = 0;
  i32[g_sys_heap_size>>2] = HEAP_SIZE;
  i32[g_sys_stack_cells>>2] = STACK_CELLS;

  // Start heap after G_SYS area.
  i32[g_sys_heap>>2] = i32[g_sys_heap_start>>2] + 256;
  i32[g_sys_heap>>2] += 4;

  // Allocate stacks.
  var fp = i32[g_sys_heap>>2] + 4; i32[g_sys_heap>>2] += STACK_CELLS * 4;
  var rp = i32[g_sys_heap>>2] + 4; i32[g_sys_heap>>2] += STACK_CELLS * 4;
  var sp = i32[g_sys_heap>>2] + 4; i32[g_sys_heap>>2] += STACK_CELLS * 4;

  // FORTH worldlist (relocated when vocabularies added).
  var forth_wordlist = i32[g_sys_heap>>2];
  COMMA(0);
  // Vocabulary stack.
  i32[g_sys_current>>2] = forth_wordlist;
  i32[g_sys_context>>2] = i32[g_sys_heap>>2];
  i32[g_sys_latestxt>>2] = 0;
  COMMA(forth_wordlist);
  for (var i = 0; i < VOCABULARY_DEPTH; ++i) { COMMA(0); }

  // setup boot text.
  var source = g_sys_heap;
  i32[g_sys_heap>>2] = Load(i32[g_sys_heap>>2], boot);
  var source_len = g_sys_heap - source;
  i32[g_sys_boot>>2] = source;
  i32[g_sys_boot_size>>2] = source_len;

  InitDictionary();

  i32[g_sys_latestxt>>2] = 0;  // So last builtin doesn't get wrong size.
  i32[g_sys_DOLIT_XT>>2] = Find("DOLIT");
  i32[g_sys_DOFLIT_XT>>2] = Find("DOFLIT");
  i32[g_sys_DOEXIT_XT>>2] = Find("EXIT");
  i32[g_sys_YIELD_XT>>2] = Find("YIELD");

  // Init code.
  var start = i32[g_sys_heap>>2];
  COMMA(Find("EVALUATE1"));
  COMMA(Find("BRANCH"));
  COMMA(start);

  i32[g_sys_argc>>2] = 0;
  i32[g_sys_argv>>2] = 0;
  i32[g_sys_base>>2] = 10;
  i32[g_sys_tib>>2] = source;
  i32[g_sys_ntib>>2] = source_len;

  rp += 4; i32[rp>>2] = fp;
  rp += 4; i32[rp>>2] = sp;
  rp += 4; i32[rp>>2] = start;
  i32[g_sys_rp>>2] = rp;
}

function VM(stdlib, foreign, heap) {
  "use asm";

  var imul = stdlib.Math.imul;
  var fround = stdlib.Math.fround;

  var sqrt = stdlib.Math.sqrt;
  var sin = stdlib.Math.sin;
  var cos = stdlib.Math.cos;
  var atan2 = stdlib.Math.atan2;
  var floor = stdlib.Math.floor;
  var exp = stdlib.Math.exp;
  var log = stdlib.Math.log;
  var pow = stdlib.Math.pow;
  var fabs = stdlib.Math.abs;
  var fmin = stdlib.Math.min;
  var fmax = stdlib.Math.max;

  var SSMOD = foreign.SSMOD;
  var Call = foreign.Call;
  var COMMA = foreign.COMMA;
  var CCOMMA = foreign.CCOMMA;
  var DOES = foreign.DOES;
  var DOIMMEDIATE = foreign.DOIMMEDIATE;
  var UNSMUDGE = foreign.UNSMUDGE;
  var create = foreign.create;
  var find = foreign.find;
  var parse = foreign.parse;
  var memset = foreign.memset;
  var memmove = foreign.memmove;
  var convert = foreign.convert;
  var fconvert = foreign.fconvert;
  var evaluate1 = foreign.evaluate1;
  var emitlog = foreign.log;

  var u8 = new stdlib.Uint8Array(heap);
  var i16 = new stdlib.Int16Array(heap);
  var i32 = new stdlib.Int32Array(heap);
  var f32 = new stdlib.Float32Array(heap);

{{sys}}

  function run() {
    var tos = 0;
    var ip = 0;
    var sp = 0;
    var rp = 0;
    var fp = 0;
    var w = 0;
    var ir = 0;
    var ft = fround(0.0);

    // UNPARK
    rp = i32[g_sys_rp>>2]|0;
    ip = i32[rp>>2]|0; rp = (rp - 4)|0;
    sp = i32[rp>>2]|0; rp = (rp - 4)|0;
    fp = i32[rp>>2]|0; rp = (rp - 4)|0;
    tos = i32[sp>>2]|0; sp = (sp - 4)|0;
    for (;;) {
      w = i32[ip>>2]|0;
      emitlog(ip|0);
      ip = (ip + 4)|0;
      decode: for (;;) {
        ir = u8[w]|0;
        emitlog(ir|0);
        switch (ir&0xff) {
{{cases}}
          default:
            break;
        }
        break;
      }
    }
  }
  return {run: run};
}

var ffi = {
  Call: Call,
  create: function() { console.log('create'); },
  parse: function() { console.log('parse'); },
  COMMA: function(n) { COMMA(n); },
  CCOMMA: function(n) { COMMA(n); },
  SSMOD: function() { console.log('ssmod'); },
  DOES: function() { console.log('does'); },
  DOIMMEDIATE: function() { console.log('immediate'); },
  UNSMUDGE: function() { console.log('unsmudge'); },
  parse: function() { console.log('parse'); },
  find: function() { console.log('find'); },
  memmove: function() { console.log('memmove'); },
  memset: function() { console.log('memset'); },
  convert: function() { console.log('convert'); },
  fconvert: function() { console.log('fconvert'); },
  evaluate1: function() { console.log('evaluate1'); },
  log: function(n) { console.log(n); }
};

heap[128 + 6] = 256 * 4;  // set g_sys.heap = 256 * 4;

function getGlobalObj() {
  return (function(g) {
    return g;
  })(new Function('return this')());
}
var globalObj = getGlobalObj();

var module = VM(globalObj, ffi, heap);
Init();
setTimeout(function() {
  module.run();
}, 10);

})();
