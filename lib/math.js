// Giải câu hỏi math challenge của game ATF (anti-bot).
// Trả về số nguyên, phù hợp với ràng buộc /^-?\d{1,4}$/ của frontend.

const WORD_OPS = [
  [/plus|\+|add(ed)?|sum of/gi, '+'],
  [/minus|subtract(ed)?|take away|less than/gi, '-'],
  [/times|multipli(ed)?|product of|multiply by/gi, '*'],
  [/divided by|divide(d)? by|over/gi, '/'],
];

function normalize(text) {
  let t = String(text || '')
    .replace(/[?？]/g, ' ')
    .replace(/[×xX⋅∗]/g, '*')
    .replace(/[÷]/g, '/')
    .replace(/[−–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [re, op] of WORD_OPS) {
    t = t.replace(re, ` ${op} `);
  }
  return t;
}

function evaluate(num1, op, num2) {
  const a = parseFloat(num1);
  const b = parseFloat(num2);
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? NaN : a / b;
    default: return NaN;
  }
}

function solveMathQuestion(question) {
  const text = normalize(question);
  const re = /(-?\d+(?:\.\d+)?)\s*([+\-*/])\s*(-?\d+(?:\.\d+)?)/g;
  const matches = [...text.matchAll(re)];
  if (matches.length === 0) {
    throw new Error(`Cannot parse math question: ${question}`);
  }
  let best = null;
  for (const m of matches) {
    const val = evaluate(m[1], m[2], m[3]);
    if (Number.isFinite(val)) {
      const length = m[0].length;
      if (!best || length > best.length) best = { value: val, length };
    }
  }
  if (!best) throw new Error(`Cannot solve math question: ${question}`);
  const answer = Math.round(best.value);
  if (!/^-?\d{1,4}$/.test(String(answer))) {
    throw new Error(`Answer out of allowed range for: ${question}`);
  }
  return answer;
}

module.exports = { solveMathQuestion, normalize };
