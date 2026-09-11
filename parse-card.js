(function (root) {
  const SCHOOL_LINE =
    /kearny|high|school|sch[oa0]{1,2}[o0ql]l|college|connections|student\s*id|identification/i
  const YEAR_LINE = /20\d{2}\s*[-–]\s*20\d{2}|20\d{2}\s*[-–]\s*\d{2}/
  const ID_OR_GRADE = /grade|id\s*numb/i

  function normalizeOcr(text) {
    return String(text || '')
      .replace(/\r/g, '\n')
      .replace(/[|]/g, 'I')
      .replace(/\b1D\b/gi, 'ID')
      .replace(/ID\s*NUMB[E8]R/gi, 'ID NUMBER')
      .replace(/GRA[D0]E/gi, 'GRADE')
  }

  function titleCaseWord(word) {
    return word
      .split('-')
      .map(function (part) {
        if (!part) return part
        return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      })
      .join('-')
  }

  function toDisplayName(value) {
    return String(value || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(titleCaseWord)
      .join(' ')
  }

  function nameNearIdLines(lines) {
    const offsets = [-1, -2, 1, 2]
    for (let i = 0; i < lines.length; i++) {
      if (!ID_OR_GRADE.test(lines[i])) continue
      for (let k = 0; k < offsets.length; k++) {
        const j = i + offsets[k]
        if (j < 0 || j >= lines.length) continue
        const candidate = looksLikeName(lines[j])
        if (candidate) return candidate
      }
    }
    return ''
  }

  function looksLikeName(line) {
    const cleaned = line.replace(/[^A-Za-z\s'-]/g, ' ').replace(/\s+/g, ' ').trim()
    if (!cleaned || SCHOOL_LINE.test(cleaned) || YEAR_LINE.test(line)) return ''
    if (/grade|id\s*number|idnumber/i.test(cleaned)) return ''
    const words = cleaned.split(' ').filter(function (word) {
      return word.length >= 2
    })
    const particle = /^(de|da|del|la|le|el|van|von|st|mc)$/i
    while (words.length > 2 && words[0].length <= 3 && !particle.test(words[0])) {
      words.shift()
    }
    while (
      words.length > 2 &&
      words[words.length - 1].length <= 3 &&
      !particle.test(words[words.length - 1])
    ) {
      words.pop()
    }
    if (words.length < 2 || words.length > 4) return ''
    const letterCount = words.join('').replace(/[^A-Za-z]/g, '').length
    if (letterCount < 6) return ''
    return toDisplayName(words.join(' '))
  }

  function parseIdCardText(text) {
    const cleaned = normalizeOcr(text)
    let studentId = ''
    let idMatch = cleaned.match(/id\s*numb(?:er)?\s*:?\s*([0-9]{4,10})/i)
    if (!idMatch) idMatch = cleaned.match(/id\s*(?:no|num|#)\.?\s*:?\s*([0-9]{4,10})/i)
    if (idMatch) studentId = idMatch[1]

    if (!studentId) {
      const numbers = []
      const numberRe = /\b([0-9]{5,8})\b/g
      let match
      while ((match = numberRe.exec(cleaned))) {
        if (!/^20[0-9]{2}$/.test(match[1])) numbers.push(match[1])
      }
      if (numbers.length) studentId = numbers[numbers.length - 1]
    }

    let grade = ''
    const gradeMatch = cleaned.match(/grade\s*:?\s*([0-9]{1,2})/i)
    if (gradeMatch) grade = gradeMatch[1]

    const lines = cleaned
      .split('\n')
      .map(function (line) {
        return line.trim()
      })
      .filter(Boolean)
    let name = nameNearIdLines(lines)
    if (!name) {
      for (let i = lines.length - 1; i >= 0; i--) {
        name = looksLikeName(lines[i])
        if (name) break
      }
    }

    return {
      name: name,
      studentId: studentId,
      grade: grade
    }
  }

  function normalizeBarcode(value) {
    const digits = String(value || '').replace(/[^0-9]/g, '')
    if (digits.length >= 4 && digits.length <= 10) return digits
    return ''
  }

  function isWeakName(name) {
    return !name || SCHOOL_LINE.test(name)
  }

  function mergeScanResult(ocr, barcode) {
    const result = {
      name: (ocr && ocr.name) || '',
      studentId: (ocr && ocr.studentId) || '',
      grade: (ocr && ocr.grade) || ''
    }
    const fromBarcode = normalizeBarcode(barcode)
    if (fromBarcode) result.studentId = fromBarcode
    return result
  }

  const api = {
    parseIdCardText: parseIdCardText,
    normalizeBarcode: normalizeBarcode,
    mergeScanResult: mergeScanResult,
    toDisplayName: toDisplayName,
    isWeakName: isWeakName
  }

  root.parseIdCard = api
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api
  }
})(typeof window !== 'undefined' ? window : globalThis)
