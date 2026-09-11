;(function () {
  const STORAGE = {
    records: 'kearny-checkin-records',
    settings: 'kearny-checkin-settings',
    roster: 'kearny-checkin-roster'
  }

  const DEFAULT_SETTINGS = {
    schoolName: 'Kearny High School',
    startTime: '08:45',
    graceMinutes: 0,
    exportEmail: ''
  }

  const video = document.getElementById('camera')
  const photoInput = document.getElementById('photo-input')
  const scannerDialog = document.getElementById('scanner-dialog')
  const processDialog = document.getElementById('process-dialog')
  const confirmDialog = document.getElementById('confirm-dialog')
  const settingsDialog = document.getElementById('settings-dialog')
  const exportDialog = document.getElementById('export-dialog')
  let cameraStream = null
  let ocrWorker = null
  let lastImage = null
  let lastRotation = 0
  let pendingExport = null

  const CLOSE_ICON = `
    <svg viewBox='0 0 24 24' aria-hidden='true'>
      <circle cx='12' cy='12' r='9' fill='none' stroke='currentColor' stroke-width='1.8'></circle>
      <path d='M9 9l6 6M15 9l-6 6' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'></path>
    </svg>
  `

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : fallback
    } catch (err) {
      return fallback
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value))
  }

  function getSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, loadJson(STORAGE.settings, {}))
  }

  function getRecords() {
    return loadJson(STORAGE.records, [])
  }

  function getRoster() {
    return loadJson(STORAGE.roster, {})
  }

  function pad(value) {
    return String(value).padStart(2, '0')
  }

  function localDateKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
  }

  function todayKey() {
    return localDateKey(new Date())
  }

  function parseTimeToMinutes(hhmm) {
    const parts = String(hhmm || '08:45').split(':')
    return Number(parts[0]) * 60 + Number(parts[1] || 0)
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  function formatTimeLabel(hhmm) {
    const parts = String(hhmm).split(':')
    const date = new Date()
    date.setHours(Number(parts[0]), Number(parts[1] || 0), 0, 0)
    return formatTime(date)
  }

  function isTardyAt(date, settings) {
    const minutes = date.getHours() * 60 + date.getMinutes()
    const cutoff = parseTimeToMinutes(settings.startTime) + Number(settings.graceMinutes || 0)
    return minutes > cutoff
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
  }

  function viewedDate() {
    return document.getElementById('view-date').value || todayKey()
  }

  function recordsForDay(day) {
    return getRecords()
      .filter(function (record) {
        return localDateKey(new Date(record.scannedAt)) === day
      })
      .sort(function (a, b) {
        return new Date(b.scannedAt) - new Date(a.scannedAt)
      })
  }

  function updateClock() {
    const now = new Date()
    const settings = getSettings()
    document.getElementById('live-clock').textContent = formatTime(now)
    document.getElementById('today-label').textContent = now.toLocaleDateString([], {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    })
    document.getElementById('school-name').textContent = settings.schoolName
    document.getElementById('start-time-label').textContent = formatTimeLabel(settings.startTime)
    const flag = document.getElementById('now-tardy-flag')
    const tardy = isTardyAt(now, settings)
    flag.textContent = tardy ? 'After start — scans are tardy' : 'Before start — on time'
    flag.classList.toggle('is-tardy', tardy)
  }

  function renderRecords() {
    const day = viewedDate()
    const records = recordsForDay(day)
    const tardyCount = records.filter(function (record) {
      return record.tardy
    }).length
    const summary = document.getElementById('log-summary')
    const list = document.getElementById('record-list')
    const empty = document.getElementById('empty-state')

    if (!records.length) {
      summary.textContent = 'No scans yet'
      list.innerHTML = ''
      empty.hidden = false
      return
    }

    summary.textContent =
      records.length +
      ' check-in' +
      (records.length === 1 ? '' : 's') +
      ' · ' +
      tardyCount +
      ' tardy'
    empty.hidden = true
    list.innerHTML = records
      .map(function (record) {
        const when = new Date(record.scannedAt)
        const gradeLine = record.grade ? ' · Grade ' + escapeHtml(record.grade) : ''
        const pillClass = record.tardy ? 'pill-tardy' : 'pill-ok'
        const pillLabel = record.tardy ? 'Tardy' : 'On time'
        return `
          <li class='record'>
            <time>${escapeHtml(formatTime(when))}</time>
            <div>
              <strong>${escapeHtml(record.name)}</strong>
              <p class='meta'>${escapeHtml(record.studentId)}${gradeLine}</p>
            </div>
            <span class='pill ${pillClass}'>${pillLabel}</span>
            <button
              class='record-delete'
              type='button'
              data-delete='${escapeHtml(record.id)}'
              aria-label='Remove'
            >
              ${CLOSE_ICON}
            </button>
          </li>
        `
      })
      .join('')
  }

  function fillSettingsForm() {
    const settings = getSettings()
    document.getElementById('setting-school').value = settings.schoolName
    document.getElementById('setting-start').value = settings.startTime
    document.getElementById('setting-grace').value = settings.graceMinutes
    document.getElementById('setting-export-email').value = settings.exportEmail || ''
  }

  function stopCamera() {
    if (!cameraStream) return
    cameraStream.getTracks().forEach(function (track) {
      track.stop()
    })
    cameraStream = null
    video.srcObject = null
  }

  async function startCamera() {
    const error = document.getElementById('camera-error')
    error.hidden = true
    try {
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          }
        })
      } catch (inner) {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: 'environment' }
        })
      }
      video.srcObject = cameraStream
      if (video.readyState < 2) {
        await new Promise(function (resolve, reject) {
          video.onloadedmetadata = function () {
            resolve()
          }
          video.onerror = function () {
            reject(new Error('Camera preview failed'))
          }
        })
      }
      await video.play()
    } catch (err) {
      error.hidden = false
      error.textContent =
        'Camera is blocked on this page. Use Upload or take photo instead, or open the site over https.'
    }
  }

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal()
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close()
  }

  function setProcessStatus(message, percent) {
    document.getElementById('process-status').textContent = message
    document.getElementById('progress-bar').style.width = Math.max(8, percent) + '%'
  }

  function snapshotFromVideo(videoEl) {
    const width = videoEl.videoWidth
    const height = videoEl.videoHeight
    if (!width || !height) {
      throw new Error('Camera frame is empty')
    }
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.getContext('2d').drawImage(videoEl, 0, 0, width, height)
    return canvas
  }

  function freezeSource(source) {
    if (source && source.tagName === 'VIDEO') return snapshotFromVideo(source)
    return source
  }

  function drawSourceToCanvas(source, rotation) {
    const width = source.naturalWidth || source.videoWidth || source.width
    const height = source.naturalHeight || source.videoHeight || source.height
    if (!width || !height) {
      throw new Error('Captured image has no pixels')
    }
    const turns = ((rotation % 360) + 360) % 360
    const swapped = turns === 90 || turns === 270
    const outW = swapped ? height : width
    const outH = swapped ? width : height
    const maxDim = 1600
    const scale = Math.min(1, maxDim / Math.max(outW, outH))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(outW * scale)
    canvas.height = Math.round(outH * scale)
    const ctx = canvas.getContext('2d')
    ctx.translate(canvas.width / 2, canvas.height / 2)
    ctx.rotate((turns * Math.PI) / 180)
    ctx.drawImage(
      source,
      0,
      0,
      width,
      height,
      (-outW * scale) / 2,
      (-outH * scale) / 2,
      outW * scale,
      outH * scale
    )
    return canvas
  }

  function cropCanvas(source, yStart, yEnd) {
    const canvas = document.createElement('canvas')
    const sy = Math.round(source.height * yStart)
    const sh = Math.max(1, Math.round(source.height * (yEnd - yStart)))
    canvas.width = Math.max(1, source.width)
    canvas.height = sh
    canvas.getContext('2d').drawImage(source, 0, sy, source.width, sh, 0, 0, canvas.width, sh)
    return canvas
  }

  function contrastCanvas(source) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, source.width)
    canvas.height = Math.max(1, source.height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(source, 0, 0)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const data = image.data
    for (let i = 0; i < data.length; i += 4) {
      const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      const next = gray < 150 ? Math.max(0, gray * 0.65) : Math.min(255, 255 - (255 - gray) * 0.15)
      data[i] = data[i + 1] = data[i + 2] = next
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  function decodeBarcode(canvas) {
    if (typeof ZXing === 'undefined') return Promise.resolve('')

    return new Promise(function (resolve) {
      try {
        const hints = new Map()
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true)
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.CODE_128,
          ZXing.BarcodeFormat.CODE_39,
          ZXing.BarcodeFormat.CODABAR,
          ZXing.BarcodeFormat.ITF,
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.UPC_A
        ])
        const reader = new ZXing.BrowserMultiFormatReader(hints)
        const url = canvas.toDataURL('image/jpeg', 0.92)
        reader
          .decodeFromImageUrl(url)
          .then(function (result) {
            resolve(result && result.getText ? result.getText() : '')
          })
          .catch(function () {
            resolve('')
          })
      } catch (err) {
        resolve('')
      }
    })
  }

  async function getWorker() {
    if (ocrWorker) return ocrWorker
    ocrWorker = await Tesseract.createWorker('eng', 1, {
      logger: function (message) {
        if (message.status === 'recognizing text' && message.progress) {
          setProcessStatus('Reading the name and ID…', 35 + message.progress * 55)
        }
      }
    })
    await ocrWorker.setParameters({
      tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:-' "
    })
    return ocrWorker
  }

  async function recognizeText(canvas) {
    const worker = await getWorker()
    const result = await worker.recognize(canvas)
    return result.data.text || ''
  }

  function lookupRoster(studentId) {
    if (!studentId) return null
    return getRoster()[studentId] || null
  }

  function rememberRoster(record) {
    if (!record.studentId || !record.name) return
    const roster = getRoster()
    roster[record.studentId] = {
      name: record.name,
      grade: record.grade || ''
    }
    saveJson(STORAGE.roster, roster)
  }

  function showPreview(source) {
    const url = typeof source === 'string' ? source : source.toDataURL('image/jpeg', 0.85)
    document.getElementById('preview-image').src = url
    const confirmImage = document.getElementById('confirm-image')
    confirmImage.src = url
    confirmImage.hidden = false
  }

  function openConfirm(values, fromScan) {
    const settings = getSettings()
    const now = new Date()
    const tardy = isTardyAt(now, settings)
    document.getElementById('confirm-title').textContent = values.manual
      ? 'Manual check-in'
      : 'Confirm check-in'
    document.getElementById('field-name').value = values.name || ''
    document.getElementById('field-id').value = values.studentId || ''
    document.getElementById('field-grade').value = values.grade || ''
    document.getElementById('confirm-meta').textContent =
      formatTime(now) + ' · ' + (tardy ? 'Will be marked tardy' : 'Will be marked on time')
    document.querySelector('[data-retry-rotate]').hidden = !fromScan
    const duplicate = document.getElementById('duplicate-warn')
    const already = recordsForDay(todayKey()).some(function (record) {
      return record.studentId && record.studentId === values.studentId
    })
    duplicate.hidden = !already
    duplicate.textContent = already
      ? 'This student ID already has a check-in today. You can still save another.'
      : ''
    openDialog(confirmDialog)
  }

  async function processImage(source, rotation) {
    const frozen = freezeSource(source)
    lastImage = frozen
    lastRotation = rotation || 0
    closeDialog(scannerDialog)
    stopCamera()
    openDialog(processDialog)
    setProcessStatus('Preparing the photo…', 12)

    const full = drawSourceToCanvas(frozen, lastRotation)
    showPreview(full)
    const textBand = contrastCanvas(cropCanvas(full, 0.55, 0.92))
    const barcodeBand = cropCanvas(full, 0.78, 1)

    setProcessStatus('Looking for the barcode…', 28)
    let barcodeText = await decodeBarcode(barcodeBand)
    if (!barcodeText) barcodeText = await decodeBarcode(full)

    setProcessStatus('Reading the name and ID…', 40)
    const ocrText = await recognizeText(textBand)
    let parsed = window.parseIdCard.parseIdCardText(ocrText)
    if (window.parseIdCard.isWeakName(parsed.name) || !parsed.studentId) {
      const fullText = await recognizeText(contrastCanvas(full))
      const parsedFull = window.parseIdCard.parseIdCardText(ocrText + '\n' + fullText)
      parsed = {
        name: window.parseIdCard.isWeakName(parsed.name) ? parsedFull.name : parsed.name,
        studentId: parsed.studentId || parsedFull.studentId,
        grade: parsed.grade || parsedFull.grade
      }
    }

    const merged = window.parseIdCard.mergeScanResult(parsed, barcodeText)
    const known = lookupRoster(merged.studentId)
    if (known) {
      if (!merged.name) merged.name = known.name
      if (!merged.grade) merged.grade = known.grade
    }

    closeDialog(processDialog)
    openConfirm(merged, true)
  }

  async function handleCapture() {
    if (!video.videoWidth || video.readyState < 2) {
      document.getElementById('camera-error').hidden = false
      document.getElementById('camera-error').textContent =
        'The camera is still starting. Try again in a moment.'
      return
    }
    const frame = snapshotFromVideo(video)
    closeDialog(scannerDialog)
    stopCamera()
    await processImage(frame, 0)
  }

  function loadFile(file) {
    if (!file) return
    const image = new Image()
    image.onload = function () {
      processImage(image, 0).catch(function (err) {
        closeDialog(processDialog)
        alert('Could not read that photo. Try again or type the name and ID.')
        console.error(err)
      })
    }
    image.onerror = function () {
      alert('That file could not be opened as an image.')
    }
    image.src = URL.createObjectURL(file)
  }

  function exportRows(records) {
    return records.map(function (record) {
      const when = new Date(record.scannedAt)
      return {
        'Student Name': record.name,
        'Student ID': record.studentId,
        Grade: record.grade || '',
        Date: localDateKey(when),
        Time: formatTime(when),
        Timestamp: when.toISOString(),
        Tardy: record.tardy ? 'Yes' : 'No',
        Source: record.source || 'scan'
      }
    })
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  function csvEscape(value) {
    const text = String(value == null ? '' : value)
    if (/[",\n]/.test(text)) return '"' + text.replaceAll('"', '""') + '"'
    return text
  }

  function csvText(records) {
    const rows = exportRows(records)
    const headers = Object.keys(rows[0])
    const lines = [headers.join(',')].concat(
      rows.map(function (row) {
        return headers
          .map(function (key) {
            return csvEscape(row[key])
          })
          .join(',')
      })
    )
    return lines.join('\n')
  }

  function csvBlob(records) {
    return new Blob([csvText(records)], { type: 'text/csv;charset=utf-8' })
  }

  function xlsxBlob(records) {
    const rows = exportRows(records)
    const sheet = XLSX.utils.json_to_sheet(rows)
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Check-ins')
    const bytes = XLSX.write(book, { bookType: 'xlsx', type: 'array' })
    return new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    })
  }

  function buildExport(records, filename, kind) {
    if (kind === 'xlsx') {
      return {
        blob: xlsxBlob(records),
        filename: filename,
        mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    }
    return {
      blob: csvBlob(records),
      filename: filename,
      mime: 'text/csv;charset=utf-8'
    }
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
  }

  function saveExportEmail(email) {
    const settings = getSettings()
    settings.exportEmail = email
    saveJson(STORAGE.settings, settings)
  }

  function openExportDialog(records, filename, kind) {
    if (!records.length) {
      alert('There are no check-ins to export for this view.')
      return
    }
    pendingExport = { records: records, filename: filename, kind: kind }
    document.getElementById('export-title').textContent =
      kind === 'xlsx' ? 'Export Excel' : 'Export CSV'
    document.getElementById('export-summary').textContent =
      records.length +
      ' check-in' +
      (records.length === 1 ? '' : 's') +
      ' · ' +
      filename
    document.getElementById('export-email').value = getSettings().exportEmail || ''
    openDialog(exportDialog)
  }

  function downloadPendingExport() {
    if (!pendingExport) return
    const file = buildExport(pendingExport.records, pendingExport.filename, pendingExport.kind)
    downloadBlob(file.blob, file.filename)
    closeDialog(exportDialog)
  }

  async function emailPendingExport() {
    if (!pendingExport) return
    const email = document.getElementById('export-email').value.trim()
    if (!isValidEmail(email)) {
      alert('Enter a valid email address first.')
      document.getElementById('export-email').focus()
      return
    }
    saveExportEmail(email)
    document.getElementById('setting-export-email').value = email

    const file = buildExport(pendingExport.records, pendingExport.filename, pendingExport.kind)
    const attachment = new File([file.blob], file.filename, { type: file.mime })
    const subject = 'Kearny tardy check-ins'
    const shareText = 'Please send to ' + email
    let shared = false

    if (navigator.canShare) {
      try {
        if (navigator.canShare({ files: [attachment] })) {
          await navigator.share({
            files: [attachment],
            title: subject,
            text: shareText
          })
          shared = true
        }
      } catch (err) {
        if (err.name !== 'AbortError') console.error(err)
      }
    }

    if (shared) {
      closeDialog(exportDialog)
      return
    }

    downloadBlob(file.blob, file.filename)

    let body = 'Please attach ' + file.filename + ' (it was downloaded on this device).'
    if (pendingExport.kind === 'csv') {
      const table = csvText(pendingExport.records)
      const candidate =
        'Tardy check-in export is below. The same file was also downloaded.\n\n' + table
      if (encodeURIComponent(candidate).length < 1600) body = candidate
    }
    window.location.href =
      'mailto:' +
      encodeURIComponent(email) +
      '?subject=' +
      encodeURIComponent(subject) +
      '&body=' +
      encodeURIComponent(body)
    closeDialog(exportDialog)
  }

  function saveCheckIn(event) {
    event.preventDefault()
    const settings = getSettings()
    const now = new Date()
    const record = {
      id: 'ck_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: window.parseIdCard.toDisplayName(document.getElementById('field-name').value),
      studentId: document.getElementById('field-id').value.replace(/\s+/g, ''),
      grade: document.getElementById('field-grade').value.trim(),
      scannedAt: now.toISOString(),
      tardy: isTardyAt(now, settings),
      source: document.getElementById('confirm-image').hidden ? 'manual' : 'scan'
    }
    if (!record.name || !record.studentId) return
    const records = getRecords()
    records.push(record)
    saveJson(STORAGE.records, records)
    rememberRoster(record)
    closeDialog(confirmDialog)
    document.getElementById('confirm-image').hidden = true
    renderRecords()
  }

  document.querySelector('[data-open-scanner]').addEventListener('click', function () {
    openDialog(scannerDialog)
    startCamera()
  })

  document.querySelectorAll('[data-close-scanner]').forEach(function (button) {
    button.addEventListener('click', function () {
      closeDialog(scannerDialog)
      stopCamera()
    })
  })

  document.querySelector('[data-capture]').addEventListener('click', function () {
    handleCapture().catch(function (err) {
      closeDialog(processDialog)
      alert('Could not read the card. Try a closer photo or type the name and ID.')
      console.error(err)
    })
  })

  document.querySelector('[data-upload-photo]').addEventListener('click', function () {
    photoInput.click()
  })

  photoInput.addEventListener('change', function () {
    loadFile(photoInput.files[0])
    photoInput.value = ''
  })

  document.querySelector('[data-manual-entry]').addEventListener('click', function () {
    document.getElementById('confirm-image').hidden = true
    openConfirm({ manual: true }, false)
  })

  document.querySelectorAll('[data-close-confirm]').forEach(function (button) {
    button.addEventListener('click', function () {
      closeDialog(confirmDialog)
    })
  })

  document.querySelector('[data-retry-rotate]').addEventListener('click', function () {
    if (!lastImage) return
    closeDialog(confirmDialog)
    processImage(lastImage, lastRotation + 90).catch(function (err) {
      closeDialog(processDialog)
      alert('Could not reread the rotated photo.')
      console.error(err)
    })
  })

  document.getElementById('confirm-form').addEventListener('submit', saveCheckIn)

  document.querySelector('[data-open-settings]').addEventListener('click', function () {
    fillSettingsForm()
    openDialog(settingsDialog)
  })

  document.querySelector('[data-close-settings]').addEventListener('click', function () {
    closeDialog(settingsDialog)
  })

  document.getElementById('settings-form').addEventListener('submit', function (event) {
    event.preventDefault()
    saveJson(STORAGE.settings, {
      schoolName:
        document.getElementById('setting-school').value.trim() || DEFAULT_SETTINGS.schoolName,
      startTime: document.getElementById('setting-start').value || DEFAULT_SETTINGS.startTime,
      graceMinutes: Number(document.getElementById('setting-grace').value || 0),
      exportEmail: document.getElementById('setting-export-email').value.trim()
    })
    closeDialog(settingsDialog)
    updateClock()
    renderRecords()
  })

  document.getElementById('view-date').addEventListener('change', renderRecords)

  document.querySelector('[data-export-csv]').addEventListener('click', function () {
    openExportDialog(recordsForDay(viewedDate()), 'check-ins-' + viewedDate() + '.csv', 'csv')
  })

  document.querySelector('[data-export-xlsx]').addEventListener('click', function () {
    openExportDialog(recordsForDay(viewedDate()), 'check-ins-' + viewedDate() + '.xlsx', 'xlsx')
  })

  document.querySelector('[data-export-all-csv]').addEventListener('click', function () {
    closeDialog(settingsDialog)
    openExportDialog(getRecords(), 'check-ins-all.csv', 'csv')
  })

  document.querySelector('[data-export-all-xlsx]').addEventListener('click', function () {
    closeDialog(settingsDialog)
    openExportDialog(getRecords(), 'check-ins-all.xlsx', 'xlsx')
  })

  document.querySelector('[data-export-download]').addEventListener('click', downloadPendingExport)
  document.querySelector('[data-export-email]').addEventListener('click', function () {
    emailPendingExport().catch(function (err) {
      console.error(err)
      alert('Could not start the email. Download the file instead.')
    })
  })
  document.querySelectorAll('[data-close-export]').forEach(function (button) {
    button.addEventListener('click', function () {
      closeDialog(exportDialog)
    })
  })

  document.querySelector('[data-clear-day]').addEventListener('click', function () {
    const day = viewedDate()
    if (!confirm('Clear every check-in for ' + day + ' on this device?')) return
    const kept = getRecords().filter(function (record) {
      return localDateKey(new Date(record.scannedAt)) !== day
    })
    saveJson(STORAGE.records, kept)
    renderRecords()
    closeDialog(settingsDialog)
  })

  document.getElementById('record-list').addEventListener('click', function (event) {
    const button = event.target.closest('[data-delete]')
    if (!button) return
    const id = button.getAttribute('data-delete')
    saveJson(
      STORAGE.records,
      getRecords().filter(function (record) {
        return record.id !== id
      })
    )
    renderRecords()
  })

  scannerDialog.addEventListener('close', stopCamera)

  document.getElementById('view-date').value = todayKey()
  fillSettingsForm()
  updateClock()
  renderRecords()
  setInterval(updateClock, 15000)
})()
