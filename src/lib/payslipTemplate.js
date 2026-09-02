import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const f2 = (n) => (parseFloat(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Draws the reference-matched pay slip layout onto a fresh jsPDF doc and
// returns it (caller adds signatures if needed, then saves).
//
// Page is always half-letter (8.5 x 5.5in), landscape shape, so two print
// side by side on one full letter sheet, meant to be cut in half.
//
// When tripBreakdown is provided (drivers): LEFT half is a trip details
// table, RIGHT half is the payslip breakdown.
// When tripBreakdown is omitted (Admin/Support, no trip concept applies):
// the payslip breakdown uses the full page width instead of just the
// right half.
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
  const leftW = midX - M - 3
  const rightX = hasTrips ? midX + 3 : M
  const rightW = hasTrips ? (W - M - rightX) : (W - M * 2)

  if (hasTrips) {
    // Thin divider between the two halves
    doc.setDrawColor(180); doc.setLineWidth(0.2)
    doc.line(midX, M, midX, H - M)

    // LEFT HALF - trip details
    let ly = M + 4
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(0)
    doc.text('Trip Details', M, ly)
    ly += 3

    autoTable(doc, {
      startY: ly, margin: { left: M, right: W - M - leftW },
      tableWidth: leftW,
      head: [['Date', 'Doc Ref / Waybill No.', 'Trip', 'Amount']],
      body: tripBreakdown.map(t => [t.date, t.docRef || '-', t.label, f2(t.amount)]),
      styles: { fontSize: 6.5, cellPadding: 1 }, headStyles: { fillColor: [255, 180, 160], textColor: 0, fontStyle: 'bold', fontSize: 6.5 },
      columnStyles: { 3: { halign: 'right' } },
    })
    const tripTotal = tripBreakdown.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0)
    const endY = doc.lastAutoTable.finalY + 4
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
    doc.text('Total Trip Earnings:', M, endY)
    doc.text(f2(tripTotal), M + leftW, endY, { align: 'right' })
  }

  // PAYSLIP BREAKDOWN - right half (drivers) or full width (admin/support)
  let y = M + 3
  doc.setFillColor(0, 200, 0)
  doc.rect(rightX, M - 3, rightW, 3, 'F')
  y += 2

  doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(0)
  const empNoLabel = 'Employee No.'
  doc.text(empNoLabel, rightX, y)
  const empNoLabelW = doc.getTextWidth(empNoLabel)
  doc.text(employeeNo || '—', rightX + empNoLabelW + 2, y)
  doc.text('Date', rightX + rightW - 40, y)
  doc.setFont('helvetica', 'bold')
  doc.text(String(date), rightX + rightW - 26, y)
  y += 4.5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7)
  doc.text('Coverage:', rightX, y)
  doc.setFont('helvetica', 'bold')
  doc.text(String(month), rightX + 15, y, { maxWidth: rightW - 15 })
  doc.setDrawColor(0); doc.line(rightX, y + 1.5, rightX + rightW, y + 1.5)

  y += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8)
  doc.text('Employee Name:', rightX, y)
  doc.setFont('helvetica', 'bold')
  doc.text(employeeName.toUpperCase(), rightX + 24, y)
  doc.line(rightX, y + 1.5, rightX + rightW, y + 1.5)

  y += 5
  doc.setFillColor(255, 180, 160)
  doc.rect(rightX, y, rightW, 6, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0)
  doc.text('PAY SLIP', rightX + rightW / 2, y + 4.3, { align: 'center' })
  y += 10

  const labelX = rightX + 2
  const pesoX = rightX + rightW - 24
  const amtRightX = rightX + rightW - 1
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
  doc.text('Please check carefully - questions on this statement should be taken up with the office.', rightX, y)

  y += 4
  doc.setDrawColor(0); doc.line(rightX, y, rightX + rightW, y)
  y += 3.5
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(0)
  doc.text(companyName.toUpperCase(), rightX + rightW / 2, y, { align: 'center' })
  if (companyAddress) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); doc.setTextColor(90)
    doc.text(companyAddress, rightX + rightW / 2, y + 3.5, { align: 'center', maxWidth: rightW })
  }

  doc._payslipEndY = y + (companyAddress ? 6 : 3)
  doc._payslipRightX = rightX
  doc._payslipRightW = rightW
  return doc
}
