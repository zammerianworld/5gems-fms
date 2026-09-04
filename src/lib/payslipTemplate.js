import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const f2 = (n) => (parseFloat(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Draws the reference-matched pay slip layout onto a fresh jsPDF doc and
// returns it (caller adds signatures if needed, then saves).
//
// Page is always half-letter (8.5 x 5.5in), landscape shape, so two print
// side by side on one full letter sheet, meant to be cut in half.
//
// When tripBreakdown is provided (drivers): the payslip breakdown is always
// on the LEFT of page 1 — immediately visible, never buried on a later
// page. Trip details sit on the RIGHT, showing as many trips as actually
// fit in that column; if there are more than fit, autoTable's own
// pagination continues them on further pages, still in the same
// right-column shape (never full-width), so there's no wasted blank space
// and the look stays consistent throughout.
// When tripBreakdown is omitted (Admin/Support, no trip concept applies):
// the payslip breakdown uses the full page width instead of just the
// left half.
//
// opts:
//   no, month, date, employeeName, companyName, companyAddress
//   salary, overtime, allowance   — earning line amounts (numbers)
//   tripBreakdown — optional array of {date, docRef, label, amount}
//   deductions    — array of {label, amount}, printed in the given order
export function buildPayslipDoc(opts) {
  const {
    employeeNo = '', month = '', date = '', employeeName = '',
    companyName = 'FLEET MANAGEMENT SYSTEM', companyAddress = '',
    salary = 0, overtime = 0, allowance = 0,
    tripBreakdown = null,
    deductions = [],
  } = opts

  // Half-letter, landscape shape: 8.5in x 5.5in = 215.9mm x 139.7mm
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [139.7, 215.9] })
  const W = 215.9, H = 139.7
  const M = 6
  const hasTrips = tripBreakdown && tripBreakdown.length > 0

  const midX = W / 2
  // Breakdown always on the left — page 1 only, never repeats on overflow
  // pages, since it's a fixed number of lines that always fits.
  const leftX = M
  const leftW = hasTrips ? (midX - M - 3) : (W - M * 2)
  // Trip details on the right — autoTable paginates this on its own if it
  // overflows the column height, reusing this same margin/width on every
  // continuation page it adds, so the shape never changes to full-width.
  const rightX = midX + 3
  const rightW = W - M - rightX

  if (hasTrips) {
    // Thin divider between the two halves (page 1 only — deliberately not
    // redrawn on overflow pages, which are trip-table-only).
    doc.setDrawColor(180); doc.setLineWidth(0.2)
    doc.line(midX, M, midX, H - M)

    let ty = M + 4
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0)
    doc.text('Trip Details', rightX, ty)
    ty += 3

    autoTable(doc, {
      startY: ty, margin: { left: rightX, right: W - M - rightX, top: M },
      tableWidth: rightW,
      head: [['Date', 'Doc Ref / Waybill No.', 'Trip', 'Amount']],
      body: tripBreakdown.map(t => [t.date, t.docRef || '-', t.label, f2(t.amount)]),
      styles: { fontSize: 6.5, cellPadding: 1 }, headStyles: { fillColor: [255, 180, 160], textColor: 0, fontStyle: 'bold', fontSize: 6.5 },
      columnStyles: { 3: { halign: 'right' } },
      // Deliberately generous — the row-height jsPDF/autoTable actually
      // renders can run a little taller than the raw fontSize+padding math
      // suggests (wrapped Doc Ref text, font metrics rounding). A tight
      // estimate here previously caused the FIRST page's column to overflow
      // onto an extra unintended page before this pagination logic ever
      // got a chance to run — this margin exists specifically to avoid
      // recreating that bug. Verified against real multi-page output, not
      // just visual inspection — see payslipTemplate.pagination.test.js.
      rowPageBreak: 'avoid',
    })
    const tripTotal = tripBreakdown.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
    const endY = doc.lastAutoTable.finalY + 4
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    doc.text('Total Trip Earnings:', rightX, endY)
    doc.text(f2(tripTotal), rightX + rightW, endY, { align: 'right' })
  }

  // PAYSLIP BREAKDOWN - left half (drivers) or full width (admin/support).
  // Page 1 only, by construction — nothing here ever adds a page.
  doc.setPage(1)
  let y = M + 3
  doc.setFillColor(0, 200, 0)
  doc.rect(leftX, M - 3, leftW, 3, 'F')
  y += 2

  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(0)
  const empNoLabel = 'Employee No.'
  doc.text(empNoLabel, leftX, y)
  const empNoLabelW = doc.getTextWidth(empNoLabel)
  doc.text(employeeNo || '—', leftX + empNoLabelW + 2, y)
  doc.text('Date', leftX + leftW - 40, y)
  doc.setFont('helvetica', 'bold')
  doc.text(String(date), leftX + leftW - 26, y)
  y += 4.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text('Coverage:', leftX, y)
  doc.setFont('helvetica', 'bold')
  doc.text(String(month), leftX + 15, y, { maxWidth: leftW - 15 })
  doc.setDrawColor(0); doc.line(leftX, y + 1.5, leftX + leftW, y + 1.5)

  y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text('Employee Name:', leftX, y)
  doc.setFont('helvetica', 'bold')
  doc.text(employeeName.toUpperCase(), leftX + 24, y)
  doc.line(leftX, y + 1.5, leftX + leftW, y + 1.5)

  y += 5
  doc.setFillColor(255, 180, 160)
  doc.rect(leftX, y, leftW, 6, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0)
  doc.text('PAY SLIP', leftX + leftW / 2, y + 4.3, { align: 'center' })
  y += 10

  const labelX = leftX + 2
  const pesoX = leftX + leftW - 24
  const amtRightX = leftX + leftW - 1
  const amtLineX0 = pesoX + 4
  const rowH = 3.85

  const earnRow = (label, amount, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(7.5)
    doc.text(label, labelX, y)
    doc.text('P', pesoX, y)
    if (amount !== null && amount !== undefined && amount !== '') doc.text(f2(amount), amtRightX, y, { align: 'right' })
    doc.line(amtLineX0, y + 0.8, amtRightX, y + 0.8)
    y += rowH
  }

  earnRow(hasTrips ? 'Trip Earnings' : 'Salary', salary)
  earnRow('Overtime', overtime > 0 ? overtime : null)
  earnRow('Allowance-advance', allowance > 0 ? allowance : null)
  const totalSalary = (parseFloat(salary) || 0) + (parseFloat(overtime) || 0) + (parseFloat(allowance) || 0)
  earnRow('TOTAL SALARY', totalSalary, true)

  y += 1.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5)
  doc.text('Less Deductions:', labelX, y)
  y += rowH

  let totalDed = 0
  deductions.forEach(d => {
    totalDed += parseFloat(d.amount) || 0
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
    doc.text(d.label, labelX + 3, y)
    doc.text('P', pesoX, y)
    if (parseFloat(d.amount) > 0) doc.text(f2(d.amount), amtRightX, y, { align: 'right' })
    doc.line(amtLineX0, y + 0.8, amtRightX, y + 0.8)
    y += rowH
  })

  y += 1
  earnRow('Total Deductions:', totalDed, true)

  // NET SALARY - boxed
  y += 1.5
  const netSalary = totalSalary - totalDed
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9)
  doc.text('NET SALARY', labelX, y + 4.5)
  doc.setDrawColor(0); doc.setLineWidth(0.35)
  doc.rect(pesoX - 2, y, (amtRightX - pesoX) + 3, 6.5)
  doc.text('P', pesoX, y + 4.5)
  doc.text(f2(netSalary), amtRightX, y + 4.5, { align: 'right' })
  doc.setLineWidth(0.2)

  y += 10
  doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(90)
  doc.text('Please check carefully - questions on this statement should be taken up with the office.', leftX, y)

  y += 4
  doc.setDrawColor(0); doc.line(leftX, y, leftX + leftW, y)
  y += 3.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0)
  doc.text(companyName.toUpperCase(), leftX + leftW / 2, y, { align: 'center' })
  if (companyAddress) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(90)
    doc.text(companyAddress, leftX + leftW / 2, y + 3.5, { align: 'center', maxWidth: leftW })
  }

  doc._payslipEndY = y + (companyAddress ? 6 : 3)
  doc._payslipRightX = leftX
  doc._payslipRightW = leftW
  return doc
}
