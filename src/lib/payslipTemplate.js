import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const f2 = (n) => (parseFloat(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Draws the reference-matched pay slip layout onto a fresh jsPDF doc and
// returns it (caller adds signatures if needed, then saves).
//
// opts:
//   no            — slip number (e.g. cutoff index or just 1)
//   month         — period label, e.g. "6/16-22/25"
//   date          — issue date, e.g. "Jul. 22, 2025" (already formatted)
//   employeeName
//   companyName
//   companyAddress
//   salary, overtime, allowance   — earning line amounts (numbers)
//   tripBreakdown — optional array of {date, label, amount} — when present,
//                   renders a trip-details table above the Salary line and
//                   the "Salary" row is relabeled "Trip Earnings"
//   deductions    — array of {label, amount} in the exact order to print;
//                   only rows with amount > 0 still print the amount, but
//                   the label always shows (matches the reference, which
//                   prints every deduction category whether or not it has
//                   a value that cutoff)
export function buildPayslipDoc(opts) {
  const {
    no = '', month = '', date = '', employeeName = '',
    companyName = 'FLEET MANAGEMENT SYSTEM', companyAddress = '',
    salary = 0, overtime = 0, allowance = 0,
    tripBreakdown = null,
    deductions = [],
  } = opts

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' })
  const W = 215.9
  const L = 14, R = 14
  const contentW = W - L - R

  // Green top bar
  doc.setFillColor(0, 200, 0)
  doc.rect(0, 0, W, 6, 'F')

  let y = 14
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(0)
  doc.text('No.', L, y)
  doc.text(String(no), L + 12, y)
  doc.text('Month', L + 45, y)
  doc.text(String(month), L + 62, y)
  doc.text('Date', W - R - 55, y)
  doc.setFont('helvetica', 'bold')
  doc.text(String(date), W - R - 38, y)
  doc.setDrawColor(0)
  doc.line(L, y + 2, W - R, y + 2)

  y += 9
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.text('Employee Name:', L, y)
  doc.setFont('helvetica', 'bold')
  doc.text(employeeName.toUpperCase(), L + 32, y)
  doc.line(L, y + 2, W - R, y + 2)

  // Orange PAY SLIP band
  y += 6
  doc.setFillColor(255, 180, 160)
  doc.rect(L, y, contentW, 12, 'F')
  doc.setFont('helvetica', 'bold'); doc.setFontSize(16); doc.setTextColor(0)
  doc.text('PAY SLIP', W / 2, y + 8.5, { align: 'center' })
  y += 18

  // ── Trip breakdown (drivers only) ──
  if (tripBreakdown && tripBreakdown.length > 0) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5)
    doc.text('Trip Details', L, y)
    y += 3
    autoTable(doc, {
      startY: y, margin: { left: L, right: R },
      head: [['Date', 'Trip', 'Amount']],
      body: tripBreakdown.map(t => [t.date, t.label, `PHP ${f2(t.amount)}`]),
      styles: { fontSize: 8, cellPadding: 1.5 }, headStyles: { fillColor: [255, 180, 160], textColor: 0, fontStyle: 'bold' },
      columnStyles: { 2: { halign: 'right' } },
    })
    y = doc.lastAutoTable.finalY + 6
  }

  // ── Earnings grid ──
  const labelX = L + 6
  const pesoX = L + 92
  const amtRightX = W - R - 2
  const amtLineX0 = L + 100
  const rowH = 6.2

  const earnRow = (label, amount, bold) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(10)
    doc.text(label, labelX, y)
    doc.text('P', pesoX, y)
    if (amount !== null && amount !== undefined && amount !== '') doc.text(f2(amount), amtRightX, y, { align: 'right' })
    doc.line(amtLineX0, y + 1.2, amtRightX, y + 1.2)
    y += rowH
  }

  earnRow(tripBreakdown ? 'Trip Earnings' : 'Salary', salary)
  earnRow('Overtime', overtime > 0 ? overtime : null)
  earnRow('Allowance', allowance > 0 ? allowance : null)
  const totalSalary = (parseFloat(salary) || 0) + (parseFloat(overtime) || 0) + (parseFloat(allowance) || 0)
  earnRow('TOTAL SALARY', totalSalary, true)

  y += 3
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10)
  doc.text('Less Deductions:', labelX, y)
  y += rowH

  let totalDed = 0
  deductions.forEach(d => {
    totalDed += parseFloat(d.amount) || 0
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5)
    doc.text(d.label, labelX + 6, y)
    doc.text('P', pesoX, y)
    if (parseFloat(d.amount) > 0) doc.text(`${f2(d.amount)}`, amtRightX, y, { align: 'right' })
    doc.line(amtLineX0, y + 1.2, amtRightX, y + 1.2)
    y += rowH
  })

  y += 2
  earnRow('Total Deductions:', totalDed, true)

  // NET SALARY — boxed
  y += 3
  const netSalary = totalSalary - totalDed
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text('NET SALARY', labelX, y + 6)
  doc.setDrawColor(0); doc.setLineWidth(0.4)
  doc.rect(pesoX - 3, y, (amtRightX - pesoX) + 5, 9)
  doc.text('P', pesoX, y + 6)
  doc.text(f2(netSalary), amtRightX, y + 6, { align: 'right' })
  doc.setLineWidth(0.2)

  // Footer disclaimer
  y += 18
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(60)
  doc.text('Full details of your pay for this covered period are given above.', L, y)
  doc.text('Please check carefully and any questions concerning the', L, y + 4)
  doc.text('accuracy of this statement should be taken up with the office.', L, y + 8)

  y += 16
  doc.setDrawColor(0); doc.line(L, y, W - R, y)
  y += 6
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0)
  doc.text(companyName.toUpperCase(), W / 2, y, { align: 'center' })
  if (companyAddress) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80)
    doc.text(companyAddress, W / 2, y + 5, { align: 'center' })
  }

  doc._payslipEndY = y + (companyAddress ? 10 : 5)
  return doc
}
