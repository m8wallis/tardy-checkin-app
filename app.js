(function () {
  var STORAGE = {
    records: 'kearny-checkin-records',
    settings: 'kearny-checkin-settings',
    roster: 'kearny-checkin-roster'
  }

  var DEFAULT_SETTINGS = {
    schoolName: 'Kearny High School',
    startTime: '08:45',
    graceMinutes: 0
  }

  var video = document.getElementById('camera')
  var photoInput = document.getElementById('photo-input')
  var scannerDialog = document.getElementById('scanner-dialog')
  var processDialog = document.getElementById('process-dialog')
  var confirmDialog = document.getElementById('confirm-dialog')
  var settingsDialog = document.getElementById('settings-dialog')
  var cameraStream = null
  var ocrWorker = null
  var lastImage = null
  var lastRotation = 0

  function loadJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key)
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
    return (
      date.getFullYear() +
      '-' +
      pad(date.getMonth() + 1) +
      '-' +
      pad(date.getDate())
    )
  }

  function todayKey() {
    return localDateKey(new Date())
  }

  function parseTimeToMinutes(hhmm) {
    var parts = String(hhmm || '08:45').split(':')
    return Number(parts[0]) * 60 + Number(parts[1] || 0)
  }

  function formatTime(date) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  function formatTimeLabel(hhmm) {
    var parts = String(hhmm).split(':')
    var date = new Date()
    date.setHours(Number(parts[0]), Number(parts[1] || 0), 0, 0)
    return formatTime(date)
  }

  function isTardyAt(date, settings) {
    var minutes = date.getHours() * 60 + date.getMinutes()
    var cutoff = parseTimeToMinutes(settings.startTime) + Number(settings.graceMinutes || 0)
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
    var now = new Date()
    var settings = getSettings()
    document.getElementById('live-clock').textContent = formatTime(now)
    document.getElementById('today-label').textContent = now.toLocaleDateString([], {
      weekday: 'long',
      month: 'short',
      day: 'numeric'
    })
    document.getElementById('school-name').textContent = settings.schoolName
    document.getElementById('start-time-label').textContent = formatTimeLabel(settings.startTime)
    var flag = document.getElementById('now-tardy-flag')
    var tardy = isTardyAt(now, settings)
    flag.textContent = tardy ? 'After start — scans are tardy' : 'Before start — on time'
    flag.classList.toggle('is-tardy', tardy)
  }

  function renderRecords() {
    var day = viewedDate()
    var records = recordsForDay(day)
    var tardyCount = records.filter(function (record) {
      return record.tardy
    }).length
    var summary = document.getElementById('log-summary')
    var list = document.getElementById('record-list')
    var empty = document.getElementById('empty-state')

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
        var when = new Date(record.scannedAt)
        return (
          "<li class='record'>" +
          '<time>' +
          escapeHtml(formatTime(when)) +
          '</time>' +
          '<div>' +
          '<strong>' +
          escapeHtml(record.name) +
          '</strong>' +
          "<p class='meta'>" +
          escapeHtml(record.studentId) +
          (record.grade ? ' · Grade ' + escapeHtml(record.grade) : '') +
          '</p>' +
          '</div>' +
          "<span class='pill " +
          (record.tardy ? 'pill-tardy' : 'pill-ok') +
          "'>" +
          (record.tardy ? 'Tardy' : 'On time') +
          '</span>' +
          "<button class='record-delete' type='button' data-delete='" +
          escapeHtml(record.id) +
          "'>Remove</button>" +
          '</li>'
        )
      })
      .join('')
  }

  function fillSettingsForm() {
    var settings = getSettings()
    document.getElementById('setting-school').value = settings.schoolName
    document.getElementById('setting-start').value = settings.startTime
    document.getElementById('setting-grace').value = settings.graceMinutes
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
    var error = document.getElementById('camera-error')
    error.hidden = true
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        }
      })
      video.srcObject = cameraStream
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

  function drawSourceToCanvas(source, rotation) {
    var width = source.naturalWidth || source.videoWidth || source.width
    var height = source.naturalHeight || source.videoHeight || source.height
    var turns = ((rotation % 360) + 360) % 360
    var swapped = turns === 90 || turns === 270
    var outW = swapped ? height : width
    var outH = swapped ? width : height
    var maxDim = 1600
    var scale = Math.min(1, maxDim / Math.max(outW, outH))
    var canvas = document.createElement('canvas')
    canvas.width = Math.round(outW * scale)
    canvas.height = Math.round(outH * scale)
    var ctx = canvas.getContext('2d')
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
    var canvas = document.createElement('canvas')
    var sy = Math.round(source.height * yStart)
    var sh = Math.round(source.height * (yEnd - yStart))
    canvas.width = source.width
    canvas.height = sh
    canvas.getContext('2d').drawImage(source, 0, sy, source.width, sh, 0, 0, source.width, sh)
    return canvas
  }

  function contrastCanvas(source) {
    var canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    var ctx = canvas.getContext('2d')
    ctx.drawImage(source, 0, 0)
    var image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    var data = image.data
    var i
    for (i = 0; i < data.length; i += 4) {
      var gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      var next = gray < 150 ? Math.max(0, gray * 0.65) : Math.min(255, 255 - (255 - gray) * 0.15)
      data[i] = data[i + 1] = data[i + 2] = next
    }
    ctx.putImageData(image, 0, 0)
    return canvas
  }

  function decodeBarcode(canvas) {
    if (typeof ZXing === 'undefined') return Promise.resolve('')

    return new Promise(function (resolve) {
      try {
        var hints = new Map()
        hints.set(ZXing.DecodeHintType.TRY_HARDER, true)
        hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
          ZXing.BarcodeFormat.CODE_128,
          ZXing.BarcodeFormat.CODE_39,
          ZXing.BarcodeFormat.CODABAR,
          ZXing.BarcodeFormat.ITF,
          ZXing.BarcodeFormat.EAN_13,
          ZXing.BarcodeFormat.UPC_A
        ])
        var reader = new ZXing.BrowserMultiFormatReader(hints)
        var url = canvas.toDataURL('image/png')
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
      tessedit_char_whitelist:
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789:-' "
    })
    return ocrWorker
  }

  async function recognizeText(canvas) {
    var worker = await getWorker()
    var result = await worker.recognize(canvas)
    return result.data.text || ''
  }

  function lookupRoster(studentId) {
    if (!studentId) return null
    return getRoster()[studentId] || null
  }

  function rememberRoster(record) {
    if (!record.studentId || !record.name) return
    var roster = getRoster()
    roster[record.studentId] = {
      name: record.name,
      grade: record.grade || ''
    }
    saveJson(STORAGE.roster, roster)
  }

  function showPreview(source) {
    var url = typeof source === 'string' ? source : source.toDataURL('image/jpeg', 0.85)
    document.getElementById('preview-image').src = url
    var confirmImage = document.getElementById('confirm-image')
    confirmImage.src = url
    confirmImage.hidden = false
  }

  function openConfirm(values, fromScan) {
    var settings = getSettings()
    var now = new Date()
    var tardy = isTardyAt(now, settings)
    document.getElementById('confirm-title').textContent = values.manual
      ? 'Manual check-in'
      : 'Confirm check-in'
    document.getElementById('field-name').value = values.name || ''
    document.getElementById('field-id').value = values.studentId || ''
    document.getElementById('field-grade').value = values.grade || ''
    document.getElementById('confirm-meta').textContent =
      formatTime(now) + ' · ' + (tardy ? 'Will be marked tardy' : 'Will be marked on time')
    document.querySelector('[data-retry-rotate]').hidden = !fromScan
    var duplicate = document.getElementById('duplicate-warn')
    var already = recordsForDay(todayKey()).some(function (record) {
      return record.studentId && record.studentId === values.studentId
    })
    duplicate.hidden = !already
    duplicate.textContent = already
      ? 'This student ID already has a check-in today. You can still save another.'
      : ''
    openDialog(confirmDialog)
  }

  async function processImage(source, rotation) {
    lastImage = source
    lastRotation = rotation || 0
    closeDialog(scannerDialog)
    stopCamera()
    openDialog(processDialog)
    setProcessStatus('Preparing the photo…', 12)

    var full = drawSourceToCanvas(source, lastRotation)
    showPreview(full)
    var textBand = contrastCanvas(cropCanvas(full, 0.55, 0.92))
    var barcodeBand = cropCanvas(full, 0.78, 1)

    setProcessStatus('Looking for the barcode…', 28)
    var barcodeText = await decodeBarcode(barcodeBand)
    if (!barcodeText) barcodeText = await decodeBarcode(full)

    setProcessStatus('Reading the name and ID…', 40)
    var ocrText = await recognizeText(textBand)
    var parsed = window.parseIdCard.parseIdCardText(ocrText)
    if (window.parseIdCard.isWeakName(parsed.name) || !parsed.studentId) {
      var fullText = await recognizeText(contrastCanvas(full))
      var parsedFull = window.parseIdCard.parseIdCardText(ocrText + '\n' + fullText)
      parsed = {
        name: window.parseIdCard.isWeakName(parsed.name) ? parsedFull.name : parsed.name,
        studentId: parsed.studentId || parsedFull.studentId,
        grade: parsed.grade || parsedFull.grade
      }
    }

    var merged = window.parseIdCard.mergeScanResult(parsed, barcodeText)
    var known = lookupRoster(merged.studentId)
    if (known) {
      if (!merged.name) merged.name = known.name
      if (!merged.grade) merged.grade = known.grade
    }

    closeDialog(processDialog)
    openConfirm(merged, true)
  }

  async function handleCapture() {
    if (!video.videoWidth) {
      document.getElementById('camera-error').hidden = false
      document.getElementById('camera-error').textContent =
        'The camera is still starting. Try again in a moment.'
      return
    }
    await processImage(video, 0)
  }

  function loadFile(file) {
    if (!file) return
    var image = new Image()
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
      var when = new Date(record.scannedAt)
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
    var url = URL.createObjectURL(blob)
    var link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  function csvEscape(value) {
    var text = String(value == null ? '' : value)
    if (/[",\n]/.test(text)) return '"' + text.replaceAll('"', '""') + '"'
    return text
  }

  function exportCsv(records, filename) {
    var rows = exportRows(records)
    if (!rows.length) {
      alert('There are no check-ins to export for this view.')
      return
    }
    var headers = Object.keys(rows[0])
    var lines = [headers.join(',')].concat(
      rows.map(function (row) {
        return headers
          .map(function (key) {
            return csvEscape(row[key])
          })
          .join(',')
      })
    )
    downloadBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), filename)
  }

  function exportXlsx(records, filename) {
    var rows = exportRows(records)
    if (!rows.length) {
      alert('There are no check-ins to export for this view.')
      return
    }
    var sheet = XLSX.utils.json_to_sheet(rows)
    var book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Check-ins')
    XLSX.writeFile(book, filename)
  }

  function saveCheckIn(event) {
    event.preventDefault()
    var settings = getSettings()
    var now = new Date()
    var record = {
      id: 'ck_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
      name: window.parseIdCard.toDisplayName(document.getElementById('field-name').value),
      studentId: document.getElementById('field-id').value.replace(/\s+/g, ''),
      grade: document.getElementById('field-grade').value.trim(),
      scannedAt: now.toISOString(),
      tardy: isTardyAt(now, settings),
      source: document.getElementById('confirm-image').hidden ? 'manual' : 'scan'
    }
    if (!record.name || !record.studentId) return
    var records = getRecords()
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
      schoolName: document.getElementById('setting-school').value.trim() || DEFAULT_SETTINGS.schoolName,
      startTime: document.getElementById('setting-start').value || DEFAULT_SETTINGS.startTime,
      graceMinutes: Number(document.getElementById('setting-grace').value || 0)
    })
    closeDialog(settingsDialog)
    updateClock()
    renderRecords()
  })

  document.getElementById('view-date').addEventListener('change', renderRecords)

  document.querySelector('[data-export-csv]').addEventListener('click', function () {
    exportCsv(recordsForDay(viewedDate()), 'check-ins-' + viewedDate() + '.csv')
  })

  document.querySelector('[data-export-xlsx]').addEventListener('click', function () {
    exportXlsx(recordsForDay(viewedDate()), 'check-ins-' + viewedDate() + '.xlsx')
  })

  document.querySelector('[data-export-all-csv]').addEventListener('click', function () {
    exportCsv(getRecords(), 'check-ins-all.csv')
  })

  document.querySelector('[data-export-all-xlsx]').addEventListener('click', function () {
    exportXlsx(getRecords(), 'check-ins-all.xlsx')
  })

  document.querySelector('[data-clear-day]').addEventListener('click', function () {
    var day = viewedDate()
    if (!confirm('Clear every check-in for ' + day + ' on this device?')) return
    var kept = getRecords().filter(function (record) {
      return localDateKey(new Date(record.scannedAt)) !== day
    })
    saveJson(STORAGE.records, kept)
    renderRecords()
    closeDialog(settingsDialog)
  })

  document.getElementById('record-list').addEventListener('click', function (event) {
    var button = event.target.closest('[data-delete]')
    if (!button) return
    var id = button.getAttribute('data-delete')
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
