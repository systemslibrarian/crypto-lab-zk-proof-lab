// @ts-check
// Sparse multivariate polynomials over a prime field, plus the univariate helpers
// the sum-check prover, the cheating provers and the GKR line reduction need.
//
// A polynomial is { variables, terms }: every term carries a canonical non-zero
// coefficient and one exponent per variable. Terms are merged and sorted, so two
// equal polynomials have identical term lists. Hypercube labels follow Thaler's
// convention: variable 1 is the most significant bit of the label.

/**
 * @typedef {Object} Term
 * @property {bigint} coefficient
 * @property {number[]} exponents
 */
/**
 * @typedef {Object} Polynomial
 * @property {number} variables
 * @property {Term[]} terms
 */
/** @typedef {import('./field.js').PrimeField} PrimeField */

export const MAX_VARIABLES = 6;
export const MAX_EXPONENT = 8;

/** @param {number[]} a @param {number[]} b */
function compareExponents(a, b) {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return b[index] - a[index];
  }
  return 0;
}

/**
 * Merge duplicate monomials, drop zero coefficients and sort highest exponent first.
 * @param {PrimeField} field
 * @param {number} variables
 * @param {Term[]} terms
 * @returns {Polynomial}
 */
export function normalizePolynomial(field, variables, terms) {
  /** @type {Map<string, Term>} */
  const merged = new Map();
  for (const term of terms) {
    if (term.exponents.length !== variables) throw new RangeError('every term must carry one exponent per variable');
    const key = term.exponents.join(',');
    const existing = merged.get(key);
    const coefficient = field.add(existing ? existing.coefficient : 0n, term.coefficient);
    merged.set(key, { coefficient, exponents: term.exponents.slice() });
  }
  const kept = [...merged.values()].filter((term) => term.coefficient !== 0n);
  kept.sort((a, b) => compareExponents(a.exponents, b.exponents));
  return { variables, terms: kept };
}

/**
 * @typedef {{ type: 'number', value: bigint, position: number }
 *   | { type: 'variable', index: number, position: number }
 *   | { type: 'caret' | 'star' | 'plus' | 'minus', position: number }} Token
 */

/** @param {string} text @returns {Token[]} */
function tokenize(text) {
  /** @type {Token[]} */
  const tokens = [];
  let position = 0;
  while (position < text.length) {
    const char = text[position];
    if (/\s/.test(char)) {
      position += 1;
      continue;
    }
    if (/[0-9]/.test(char)) {
      let end = position;
      while (end < text.length && /[0-9]/.test(text[end])) end += 1;
      tokens.push({ type: 'number', value: BigInt(text.slice(position, end)), position });
      position = end;
      continue;
    }
    if (char === 'x' || char === 'X') {
      let end = position + 1;
      while (end < text.length && /[0-9]/.test(text[end])) end += 1;
      if (end === position + 1) throw new SyntaxError(`the variable at position ${position + 1} needs an index, like x1`);
      tokens.push({ type: 'variable', index: Number(text.slice(position + 1, end)), position });
      position = end;
      continue;
    }
    switch (char) {
      case '^': tokens.push({ type: 'caret', position }); break;
      case '*': case '·': tokens.push({ type: 'star', position }); break;
      case '+': tokens.push({ type: 'plus', position }); break;
      case '-': case '−': tokens.push({ type: 'minus', position }); break;
      default: throw new SyntaxError(`unexpected "${char}" at position ${position + 1}`);
    }
    position += 1;
  }
  return tokens;
}

/**
 * Parse a polynomial written as terms joined by + or −. A term is a product of
 * integer coefficients and variables x1, x2, …, each optionally raised with ^n;
 * the * between factors is optional. Anything else is refused with its position.
 * @param {PrimeField} field
 * @param {string} text
 * @param {{ maxVariables?: number, maxExponent?: number }} [limits]
 * @returns {Polynomial}
 */
export function parsePolynomial(field, text, limits = {}) {
  const maxVariables = limits.maxVariables ?? MAX_VARIABLES;
  const maxExponent = limits.maxExponent ?? MAX_EXPONENT;
  if (typeof text !== 'string' || text.trim() === '') throw new SyntaxError('the polynomial is empty');
  const tokens = tokenize(text);
  /** @type {Array<{ coefficient: bigint, exponents: Map<number, number> }>} */
  const rawTerms = [];
  let index = 0;
  let sign = 1n;
  const first = tokens[0];
  if (first && (first.type === 'plus' || first.type === 'minus')) {
    sign = first.type === 'minus' ? -1n : 1n;
    index = 1;
  }
  let variables = 0;
  for (;;) {
    let coefficient = sign;
    /** @type {Map<number, number>} */
    const exponents = new Map();
    let factors = 0;
    let expectFactor = true;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token.type === 'plus' || token.type === 'minus') break;
      if (token.type === 'star') {
        if (expectFactor) throw new SyntaxError(`unexpected "*" at position ${token.position + 1}`);
        expectFactor = true;
        index += 1;
        continue;
      }
      if (token.type === 'caret') throw new SyntaxError(`"^" at position ${token.position + 1} must follow a variable`);
      if (token.type === 'number') {
        coefficient *= token.value;
        factors += 1;
        expectFactor = false;
        index += 1;
        continue;
      }
      if (token.type !== 'variable') throw new SyntaxError(`unexpected token at position ${token.position + 1}`);
      if (token.index < 1 || token.index > maxVariables) {
        throw new SyntaxError(`x${token.index} at position ${token.position + 1} is outside x1..x${maxVariables}`);
      }
      let exponent = 1;
      index += 1;
      const caret = tokens[index];
      if (caret && caret.type === 'caret') {
        const exponentToken = tokens[index + 1];
        if (!exponentToken || exponentToken.type !== 'number') {
          throw new SyntaxError(`"^" at position ${caret.position + 1} needs an integer exponent`);
        }
        if (exponentToken.value > BigInt(maxExponent)) {
          throw new SyntaxError(`exponent ${exponentToken.value} at position ${exponentToken.position + 1} exceeds the limit ${maxExponent}`);
        }
        exponent = Number(exponentToken.value);
        index += 2;
      }
      const total = (exponents.get(token.index) ?? 0) + exponent;
      if (total > maxExponent) throw new SyntaxError(`x${token.index} is raised beyond the exponent limit ${maxExponent}`);
      exponents.set(token.index, total);
      variables = Math.max(variables, token.index);
      factors += 1;
      expectFactor = false;
    }
    if (factors === 0 || expectFactor) {
      const at = tokens[index];
      throw new SyntaxError(at ? `a term is missing before position ${at.position + 1}` : 'the polynomial ends with an incomplete term');
    }
    rawTerms.push({ coefficient, exponents });
    if (index >= tokens.length) break;
    const operator = tokens[index];
    sign = operator.type === 'minus' ? -1n : 1n;
    index += 1;
    if (index >= tokens.length) throw new SyntaxError('the polynomial ends with a dangling sign');
  }
  if (variables === 0) throw new SyntaxError('the polynomial must mention at least one variable x1, x2, …');
  const terms = rawTerms.map(({ coefficient, exponents }) => ({
    coefficient: field.normalize(coefficient),
    exponents: Array.from({ length: variables }, (_, position) => exponents.get(position + 1) ?? 0),
  }));
  return normalizePolynomial(field, variables, terms);
}

/** Canonical text form, re-parseable by parsePolynomial. @param {Polynomial} poly */
export function formatPolynomial(poly) {
  if (poly.terms.length === 0) return '0';
  return poly.terms.map((term) => {
    const factors = term.exponents
      .map((exponent, position) => (exponent === 0 ? '' : exponent === 1 ? `x${position + 1}` : `x${position + 1}^${exponent}`))
      .filter(Boolean);
    if (factors.length === 0) return term.coefficient.toString();
    const coefficient = term.coefficient === 1n ? '' : `${term.coefficient}*`;
    return `${coefficient}${factors.join('*')}`;
  }).join(' + ');
}

/**
 * @param {PrimeField} field
 * @param {Polynomial} poly
 * @param {bigint[]} point
 */
export function evaluatePolynomial(field, poly, point) {
  if (point.length !== poly.variables) throw new RangeError(`expected ${poly.variables} coordinates, received ${point.length}`);
  let total = 0n;
  for (const term of poly.terms) {
    let value = term.coefficient;
    term.exponents.forEach((exponent, position) => {
      if (exponent > 0) value = field.mul(value, field.pow(point[position], BigInt(exponent)));
    });
    total = field.add(total, value);
  }
  return total;
}

/** The degree of each variable: deg_j(g) for j = 1..v. @param {Polynomial} poly */
export function variableDegrees(poly) {
  const degrees = new Array(poly.variables).fill(0);
  for (const term of poly.terms) {
    term.exponents.forEach((exponent, position) => {
      degrees[position] = Math.max(degrees[position], exponent);
    });
  }
  return degrees;
}

/** The Boolean point whose label is w; variable 1 is the most significant bit. @param {number} w @param {number} variables */
export function hypercubePoint(w, variables) {
  return Array.from({ length: variables }, (_, position) => BigInt((w >> (variables - 1 - position)) & 1));
}

/** Σ_{x ∈ {0,1}^v} g(x) by direct enumeration of all 2^v points. @param {PrimeField} field @param {Polynomial} poly */
export function hypercubeSum(field, poly) {
  let total = 0n;
  const count = 1 << poly.variables;
  for (let w = 0; w < count; w += 1) {
    total = field.add(total, evaluatePolynomial(field, poly, hypercubePoint(w, poly.variables)));
  }
  return total;
}

/**
 * The honest round-j message s_j(X_j) = Σ_{x_{j+1},…,x_v ∈ {0,1}} g(r_1,…,r_{j−1},X_j,x_{j+1},…,x_v),
 * as coefficients from constant term upward. On {0,1} a power x^e is x when e ≥ 1 and
 * 1 when e = 0, so each monomial's inner sum is 2 raised to the number of trailing
 * variables it does not mention.
 * @param {PrimeField} field
 * @param {Polynomial} poly
 * @param {bigint[]} prefix the challenges r_1 … r_{j−1}
 * @param {number} round j, counted from 1
 */
export function partialSumUnivariate(field, poly, prefix, round) {
  if (round < 1 || round > poly.variables) throw new RangeError(`round ${round} is outside 1..${poly.variables}`);
  if (prefix.length !== round - 1) throw new RangeError(`round ${round} needs ${round - 1} earlier challenges, received ${prefix.length}`);
  const degree = variableDegrees(poly)[round - 1];
  /** @type {bigint[]} */
  const coefficients = new Array(degree + 1).fill(0n);
  for (const term of poly.terms) {
    let value = term.coefficient;
    for (let position = 0; position < round - 1; position += 1) {
      if (term.exponents[position] > 0) value = field.mul(value, field.pow(prefix[position], BigInt(term.exponents[position])));
    }
    let unmentioned = 0;
    for (let position = round; position < poly.variables; position += 1) {
      if (term.exponents[position] === 0) unmentioned += 1;
    }
    value = field.mul(value, field.pow(2n, BigInt(unmentioned)));
    const exponent = term.exponents[round - 1];
    coefficients[exponent] = field.add(coefficients[exponent], value);
  }
  return coefficients;
}

// ---------------------------------------------------------------------------
// Univariate helpers. A univariate polynomial is its coefficient list, constant first.
// ---------------------------------------------------------------------------

/** Horner evaluation. @param {PrimeField} field @param {bigint[]} coefficients @param {bigint} x */
export function evaluateUnivariate(field, coefficients, x) {
  let result = 0n;
  for (let index = coefficients.length - 1; index >= 0; index -= 1) {
    result = field.add(field.mul(result, x), coefficients[index]);
  }
  return result;
}

/** Index of the highest non-zero coefficient, or −1 for the zero polynomial. @param {bigint[]} coefficients */
export function univariateDegree(coefficients) {
  for (let index = coefficients.length - 1; index >= 0; index -= 1) {
    if (coefficients[index] !== 0n) return index;
  }
  return -1;
}

/** @param {bigint[]} coefficients @param {string} [name] */
export function formatUnivariate(coefficients, name = 'X') {
  const parts = [];
  for (let index = coefficients.length - 1; index >= 0; index -= 1) {
    const coefficient = coefficients[index];
    if (coefficient === 0n) continue;
    const power = index === 0 ? '' : index === 1 ? name : `${name}^${index}`;
    const scalar = index === 0 ? coefficient.toString() : coefficient === 1n ? '' : `${coefficient}*`;
    parts.push(`${scalar}${power}`);
  }
  return parts.length === 0 ? '0' : parts.join(' + ');
}

/** @param {PrimeField} field @param {bigint[]} a @param {bigint[]} b */
export function addUnivariate(field, a, b) {
  const length = Math.max(a.length, b.length);
  return Array.from({ length }, (_, index) => field.add(a[index] ?? 0n, b[index] ?? 0n));
}

/** @param {PrimeField} field @param {bigint[]} a @param {bigint[]} b */
export function mulUnivariate(field, a, b) {
  if (a.length === 0 || b.length === 0) return [];
  /** @type {bigint[]} */
  const product = new Array(a.length + b.length - 1).fill(0n);
  a.forEach((left, i) => {
    b.forEach((right, j) => {
      product[i + j] = field.add(product[i + j], field.mul(left, right));
    });
  });
  return product;
}

/** @param {PrimeField} field @param {bigint[]} a @param {bigint} scalar */
export function scaleUnivariate(field, a, scalar) {
  return a.map((coefficient) => field.mul(coefficient, scalar));
}

/**
 * Lagrange interpolation through distinct points; the result has exactly xs.length coefficients.
 * @param {PrimeField} field
 * @param {bigint[]} xs
 * @param {bigint[]} ys
 */
export function interpolateUnivariate(field, xs, ys) {
  if (xs.length !== ys.length || xs.length === 0) throw new RangeError('interpolation needs matching non-empty point lists');
  /** @type {bigint[]} */
  let result = new Array(xs.length).fill(0n);
  for (let k = 0; k < xs.length; k += 1) {
    let basis = [1n];
    let denominator = 1n;
    for (let m = 0; m < xs.length; m += 1) {
      if (m === k) continue;
      basis = mulUnivariate(field, basis, [field.neg(xs[m]), 1n]);
      denominator = field.mul(denominator, field.sub(xs[k], xs[m]));
    }
    if (denominator === 0n) throw new RangeError('interpolation points must be distinct');
    result = addUnivariate(field, result, scaleUnivariate(field, basis, field.mul(ys[k], field.inv(denominator))));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Multivariate algebra for the GKR layer polynomial.
// ---------------------------------------------------------------------------

/** @param {PrimeField} field @param {number} variables @param {bigint} value */
export function constantPolynomial(field, variables, value) {
  return normalizePolynomial(field, variables, [{ coefficient: field.normalize(value), exponents: new Array(variables).fill(0) }]);
}

/** a·X_index + b, with index counted from 0. @param {PrimeField} field @param {number} variables @param {number} index @param {bigint} a @param {bigint} b */
export function linearPolynomial(field, variables, index, a, b) {
  const exponents = new Array(variables).fill(0);
  exponents[index] = 1;
  return normalizePolynomial(field, variables, [
    { coefficient: field.normalize(a), exponents },
    { coefficient: field.normalize(b), exponents: new Array(variables).fill(0) },
  ]);
}

/** @param {PrimeField} field @param {Polynomial} a @param {Polynomial} b */
export function addPolynomials(field, a, b) {
  if (a.variables !== b.variables) throw new RangeError('polynomials must share a variable count to be added');
  return normalizePolynomial(field, a.variables, [...a.terms, ...b.terms]);
}

/** @param {PrimeField} field @param {Polynomial} a @param {Polynomial} b */
export function multiplyPolynomials(field, a, b) {
  if (a.variables !== b.variables) throw new RangeError('polynomials must share a variable count to be multiplied');
  /** @type {Term[]} */
  const terms = [];
  for (const left of a.terms) {
    for (const right of b.terms) {
      terms.push({
        coefficient: field.mul(left.coefficient, right.coefficient),
        exponents: left.exponents.map((exponent, position) => exponent + right.exponents[position]),
      });
    }
  }
  return normalizePolynomial(field, a.variables, terms);
}

/** @param {PrimeField} field @param {Polynomial} a @param {bigint} scalar */
export function scalePolynomial(field, a, scalar) {
  return normalizePolynomial(field, a.variables, a.terms.map((term) => ({ coefficient: field.mul(term.coefficient, scalar), exponents: term.exponents })));
}

/** @param {number} n */
export function log2Exact(n) {
  if (!Number.isInteger(n) || n < 1 || (n & (n - 1)) !== 0) throw new RangeError(`${n} is not a power of two`);
  return Math.log2(n);
}

/** Bit i (counted from the most significant) of a k-bit label. @param {number} label @param {number} bits @param {number} position */
export function labelBit(label, bits, position) {
  return (label >> (bits - 1 - position)) & 1;
}

/**
 * χ_w(x) = Π_i (w_i x_i + (1 − w_i)(1 − x_i)): the multilinear Lagrange basis
 * polynomial for the Boolean label w, evaluated numerically at x.
 * @param {PrimeField} field
 * @param {number} label
 * @param {number} bits
 * @param {bigint[]} point
 */
export function chi(field, label, bits, point) {
  if (point.length !== bits) throw new RangeError(`χ over ${bits} bits needs ${bits} coordinates`);
  let value = 1n;
  for (let position = 0; position < bits; position += 1) {
    const coordinate = field.normalize(point[position]);
    value = field.mul(value, labelBit(label, bits, position) === 1 ? coordinate : field.sub(1n, coordinate));
  }
  return value;
}

/**
 * The multilinear extension of a table of 2^k values as an explicit polynomial, in
 * Lagrange form (Thaler, Lemma 3.6): Σ_w f(w) · χ_w(X). The k hypercube coordinates
 * occupy variables offset … offset+k−1 of a polynomial in `variables` variables.
 * @param {PrimeField} field
 * @param {bigint[]} values
 * @param {number} [variables]
 * @param {number} [offset]
 */
export function multilinearExtension(field, values, variables = log2Exact(values.length), offset = 0) {
  const bits = log2Exact(values.length);
  if (offset + bits > variables) throw new RangeError('the extension does not fit in the requested variable count');
  let result = constantPolynomial(field, variables, 0n);
  values.forEach((value, label) => {
    const coefficient = field.normalize(value);
    if (coefficient === 0n) return;
    let term = constantPolynomial(field, variables, coefficient);
    for (let position = 0; position < bits; position += 1) {
      const factor = labelBit(label, bits, position) === 1
        ? linearPolynomial(field, variables, offset + position, 1n, 0n)
        : linearPolynomial(field, variables, offset + position, -1n, 1n);
      term = multiplyPolynomials(field, term, factor);
    }
    result = addPolynomials(field, result, term);
  });
  return result;
}

/**
 * Evaluate the multilinear extension of a value table at one point directly from
 * the table (Thaler, Lemma 3.7 / equation 3.1), without building the polynomial.
 * This is the verifier's own route to W̃(r) for the layers whose values it knows.
 * @param {PrimeField} field
 * @param {bigint[]} values
 * @param {bigint[]} point
 */
export function evaluateMultilinearFromValues(field, values, point) {
  const bits = log2Exact(values.length);
  if (point.length !== bits) throw new RangeError(`a table of ${values.length} values is extended over ${bits} variables, received ${point.length}`);
  let total = 0n;
  values.forEach((value, label) => {
    total = field.add(total, field.mul(field.normalize(value), chi(field, label, bits, point)));
  });
  return total;
}

/**
 * Restrict a polynomial to the line t ↦ base + t·direction; returns the univariate
 * coefficients of poly(base + t·direction).
 * @param {PrimeField} field
 * @param {Polynomial} poly
 * @param {bigint[]} base
 * @param {bigint[]} direction
 */
export function restrictToLine(field, poly, base, direction) {
  if (base.length !== poly.variables || direction.length !== poly.variables) throw new RangeError('the line must live in the polynomial\'s space');
  let result = [0n];
  for (const term of poly.terms) {
    let product = [term.coefficient];
    term.exponents.forEach((exponent, position) => {
      for (let count = 0; count < exponent; count += 1) {
        product = mulUnivariate(field, product, [field.normalize(base[position]), field.normalize(direction[position])]);
      }
    });
    result = addUnivariate(field, result, product);
  }
  return result;
}
