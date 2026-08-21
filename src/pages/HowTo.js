import { useState, useMemo } from 'react'
import { useAuth } from '../components/AuthContext'

// ── GUIDE DATA ────────────────────────────────────────────────────────────────
const GUIDES = [
  {
    id: 'dashboard',
    icon: '🏠',
    title: 'Dashboard',
    roles: ['staff', 'admin', 'superuser'],
    sections: [
      {
        heading: 'Overview',
        content: [
          { type: 'text', text: 'The Dashboard is the home screen after login. It shows a live summary of the fleet, recent activity, financial alerts, and quick action buttons.' },
        ],
      },
      {
        heading: 'What Each Section Shows',
        content: [
          { type: 'table', rows: [
            ['Section', 'What it shows'],
            ['Greeting + Date', 'Current date and your name'],
            ['How-To Guide banner', 'Quick link to this guide — tap to open'],
            ['Insurance / Amortization alerts', 'Orange warning if any payment is expiring within 30 days'],
            ['OR/CR alerts', 'Red warning if any truck registration is expiring'],
            ['PDC due this week', 'Purple alert listing post-dated checks due in the next 7 days with payee and amount'],
            ['60+ day overdue card', 'Red urgent card listing invoices unpaid for 60+ days — links directly to the Aging Report'],
            ['KPI cards', 'This month: Revenue, Expenses, Net Profit, Active Trucks'],
            ['Revenue graph', 'Monthly revenue bar chart — use the month selector to change the view'],
            ['Recent Trips', 'Last 5 trips entered across dump and PM'],
            ['Recent Invoices', 'Last 5 invoices with status badges'],
            ['Quick Actions', 'Shortcuts to New Trip, Generate SOA, Add Expense, Summary, How-To Guide'],
          ]},
        ],
      },
      {
        heading: 'Global Search',
        content: [
          { type: 'text', text: 'Press "/" from anywhere in the app (when not typing in a field) to open the global search — also available via the search bar on this dashboard, the sidebar "Search…" button, or the 🔍 icon in the mobile topbar.' },
          { type: 'steps', items: [
            'Type at least 2 characters to search invoices (by invoice no. or client), Dump Truck trips (plate, SMCSL WB, client), and Prime Mover trips (plate, waybill no., client).',
            'Use ↑↓ to navigate results, Enter to open, Esc to close.',
            'Clicking a result jumps you straight to the matching invoice in Billing, or the matching trip in Trip Entry with the search term pre-filled.',
          ]},
        ],
      },
      {
        heading: 'Keyboard Shortcuts',
        content: [
          { type: 'table', rows: [
            ['Key', 'Action'],
            ['/', 'Open global search (from anywhere)'],
            ['N', 'Go to New Trip'],
            ['E', 'Go to Expenses'],
            ['B', 'Go to Billing'],
            ['R', 'Refresh dashboard data'],
          ]},
          { type: 'note', text: 'Shortcuts only work when focus is not inside a text input, dropdown, or textarea.' },
        ],
      },
      {
        heading: 'Refresh',
        content: [
          { type: 'text', text: 'The dashboard loads data on login. If you expect new data, click the 🔄 Refresh button at the top right (or press R) to reload all figures.' },
        ],
      },
    ],
  },
  {
    id: 'getting-started',
    icon: '🚀',
    title: 'Getting Started',
    roles: ['staff', 'admin', 'superuser'],
    sections: [
      {
        heading: 'Roles & What You Can Do',
        content: [
          { type: 'table', rows: [
            ['Role', 'Access'],
            ['👤 Staff', 'Trip Entry, Expenses (operation only), Sub-con Trips, Dashboard, My Account'],
            ['🔑 Admin', 'Everything Staff can do, plus Billing, Reports, Payroll, Settings, Cashflow, Loans, Vouchers, Manage Users'],
            ['⚡ Superuser', 'Everything Admin can do, plus Activity Logs, DB Backup, granting Admin/Superuser roles, App Version & PWA Icon settings'],
          ]},
        ],
      },
      {
        heading: 'Logging In',
        content: [
          { type: 'steps', items: [
            'Go to the app URL and enter your email and password.',
            'You will be redirected to the Dashboard on success.',
            'If you see a blank white screen after login, wait 3 seconds and refresh — this is rare but can happen on slow connections.',
            'To log out, click your name/role at the bottom of the sidebar.',
          ]},
        ],
      },
      {
        heading: 'Admin Override PIN',
        content: [
          { type: 'note', text: 'Some sensitive actions (editing billed rates, approving staff expenses) require an Admin PIN. This is a 6-character code (1 letter + 5 numbers, e.g. A12345) set by the superuser per user in Manage Users.' },
        ],
      },
      {
        heading: 'Dates & Confirmation Dialogs',
        content: [
          { type: 'text', text: "All date fields across the system display as MM/DD/YYYY (e.g. 07/06/2026 for July 6, 2026) — this stays consistent regardless of your browser or phone's date settings." },
          { type: 'steps', items: [
            'Click anywhere on a date field to open the calendar picker.',
            'Pick a date, or type it directly in MM/DD/YYYY format.',
          ]},
          { type: 'note', text: "All confirmation prompts (delete, duplicate warnings, status changes) now appear as styled pop-ups matching the app design — not the browser's plain default pop-up. Duplicate warnings (e.g. same SMCSL WB already exists) show the conflicting record's plate and date so you can double-check before saving anyway." },
        ],
      },
    ],
  },
  {
    id: 'trips',
    icon: '🚛',
    title: 'Trip Entry',
    roles: ['staff', 'admin', 'superuser'],
    sections: [
      {
        heading: 'Overview',
        content: [
          { type: 'text', text: 'Trip Entry has two tabs — Dump Truck and Prime Mover. All trips start as unbilled and get assigned to an invoice in Billing.' },
        ],
      },
      {
        heading: 'Adding a Dump Truck Trip',
        content: [
          { type: 'steps', items: [
            'Go to Trip Entry → Dump Truck tab.',
            'Fill in: Date, Truck, Driver, Client, Route (From/To), Commodity, Rate.',
            'If the trip code is SMC, additional fields appear: Van No., Seal No., Con Van No., Supplier Amount, Stripping Fee.',
            'Click Save Trip.',
          ]},
        ],
      },
      {
        heading: 'Adding a Prime Mover Trip',
        content: [
          { type: 'text', text: 'The fields shown depend on the client you select — this is controlled by that client\'s "Prime Mover Trip Entry Style" set in Settings → Clientele (Container/Port by default, or Generic Van).' },
          { type: 'steps', items: [
            'Go to Trip Entry → Prime Mover tab.',
            'Fill in Trip Date, Truck Plate, and Trip Code (built-in codes like SMC, plus any custom codes added in Settings → PM Trip Codes).',
            'Select the Client — this determines which fields appear next.',
            'Container/Port clients: pick Container Size (20ft/40ft), then fill the standard fields plus per-container details using + Add Container.',
            'Generic Van clients: fill Driver, Van Number/Vessel, Destination, TOLL Ticket, TOLL Scale, and Rate/Total Amount instead — no container fields.',
            'Click Save Trip.',
          ]},
          { type: 'note', text: 'A new client defaults to Container/Port style. Switch a client to Generic Van in Settings → Clientele if their Prime Mover trips are simple point-to-point van runs rather than container/port logistics.' },
        ],
      },
      {
        heading: 'Editing or Deleting a Trip',
        content: [
          { type: 'steps', items: [
            'Find the trip in the list (use the search or filter by date/truck/client).',
            'Click ✏️ to edit or 🗑️ to delete.',
            'Deleted trips go to Trash and can be restored within 30 days.',
          ]},
          { type: 'note', text: 'Trips already added to an invoice can still be edited, but the invoice total will update automatically.' },
        ],
      },
    ],
  },
  {
    id: 'billing',
    icon: '🧾',
    title: 'Billing & SOA',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Overview',
        content: [
          { type: 'text', text: 'Billing has several tabs: Generate (create invoices), Invoice List (manage all invoices), Manage Trips (view/edit all trips across invoices), Client Balance (per-client AR statement), Paid Invoices, and Aging Report.' },
        ],
      },
      {
        heading: 'Generating an Invoice',
        content: [
          { type: 'steps', items: [
            'Go to Billing → Generate tab.',
            'Select Client and Date Range.',
            'The system pulls all unbilled trips for that client in the period.',
            'Review the trips listed. You can remove individual trips using the ✕ button.',
            'Adjust the rate per trip if needed (requires Admin PIN).',
            'Choose Invoice Type: Non-VAT (default) or VAT — see VAT & Withholding Tax below for what this changes.',
            'Click Generate Invoice. The invoice number starts blank for manual entry — type the number before printing.',
            'Click Print / Preview to open the SOA print dialog. Select signatories, then print or export.',
          ]},
        ],
      },
      {
        heading: 'Managing Invoices',
        content: [
          { type: 'steps', items: [
            'Invoice List tab shows all invoices with status (Unpaid/Partial/Paid), aging color, and totals.',
            'Click an invoice to expand — you can add more trips, edit rates, add remarks (color-coded), or mark as paid.',
            'Remarks support colors: orange, pink, yellow — useful for flagging disputes or notes.',
            'To mark paid: click Mark as Paid and enter the payment date and amount.',
            'Filter by truck plate using the "All plates" dropdown — works even for multi-truck consolidated SOAs (e.g. SMC invoices covering several plates).',
          ]},
        ],
      },
      {
        heading: 'SOA Excel & PDF Exports',
        content: [
          { type: 'steps', items: [
            'Click 🖨️ Print PDF or 📊 Excel on any invoice — both open the Signatory dialog first.',
            'Select Prepared by / Approved by names, then confirm — both formats include the signature block.',
            'Excel exports are built to visually match the printed SOA: same headers, columns, totals, amount-in-words, and signatures.',
            'Reference numbers (waybill, SAF DR, STO No., etc.) are stored as text in Excel so they never show as scientific notation (e.g. 7.22E+09).',
          ]},
        ],
      },
      {
        heading: 'Bulk Excel Export',
        content: [
          { type: 'steps', items: [
            'In Invoice List, tick the 📊 Export checkbox on any invoices you want to include (any status, not just unpaid).',
            'A blue bar appears showing the count — click 📦 Bulk Export Excel.',
            'Select signatories once — they apply to every sheet.',
            'Downloads a single .xlsx file with one sheet per invoice, named after each invoice number.',
          ]},
        ],
      },
      {
        heading: 'Manage Trips — Quick Edit',
        content: [
          { type: 'steps', items: [
            'Manage Trips lists all trips with sortable columns, filters (route, commodity, trip code, container size), and bulk rate edit / bulk delete.',
            'For trips not yet invoiced, click ✏️ next to "Pending" to open Quick Edit — covers date, plate, client, route/trip code, commodity/container size, rate or supplier amount, and remarks.',
            'For deeper edits (containers, island codes, port details) or trips already invoiced (with override PIN), use Trips.js instead.',
          ]},
        ],
      },
      {
        heading: 'Client Balance (AR Statement)',
        content: [
          { type: 'steps', items: [
            'Go to Billing → Client Balance, select a client.',
            'Use All / Paid / Unpaid (with aging) to filter. "Unpaid" adds an Aging column color-coded by days overdue (red 60+, orange 30-59).',
            '🖨️ Print PDF and 📊 Excel export the filtered list as a branded AR statement showing outstanding balance.',
          ]},
        ],
      },
      {
        heading: 'VAT & Withholding Tax',
        content: [
          { type: 'text', text: '5 Gems is Non-VAT registered, so invoices default to Non-VAT — no 12% VAT markup, just the 2% withholding tax deduction most clients apply (Total Due = Net Sales × 0.98).' },
          { type: 'note', text: 'Some clients still need a VAT-computed invoice. Choose VAT on the Invoice Type toggle when generating that invoice — the SOA print/export then shows the 12% VAT breakdown and Total Due = Net Sales × 1.12 − 2% W/Tax. This is chosen per invoice, not a global setting, and is saved with that invoice permanently.' },
          { type: 'text', text: 'Every report that shows collections or amounts due — Invoice List, Client Balance, Aging Report, Paid Invoices, Cashflow, Dashboard, Year-over-Year — automatically uses the correct VAT or Non-VAT figure for each invoice, based on how that invoice was generated.' },
        ],
      },
      {
        heading: 'Aging Report',
        content: [
          { type: 'text', text: 'The aging report groups unpaid invoices by client with color coding: green (current), yellow (30 days), orange (60 days), red (90+ days).' },
          { type: 'steps', items: [
            'Access via the Aging Report tab or the Aging button in Invoice List.',
            'Both 🖨️ Print PDF and 📊 Export Excel open the Signatory dialog first — the exported report includes Prepared by / Approved by signatures for external review.',
          ]},
        ],
      },
    ],
  },
  {
    id: 'expenses',
    icon: '💸',
    title: 'Expenses',
    roles: ['staff', 'admin', 'superuser'],
    sections: [
      {
        heading: 'Expense Types',
        content: [
          { type: 'table', rows: [
            ['Type', 'Who Can Add', 'Notes'],
            ['Operation', 'Staff + Admin', 'Truck-specific costs (fuel, repairs, etc.)'],
            ['Admin', 'Admin only', 'Office/overhead costs — auto-divided across all trucks'],
            ['Amortization', 'Admin only', 'Monthly loan/equipment payments with schedule'],
            ['Insurance', 'Admin only', 'Annual premium with monthly spread'],
          ]},
        ],
      },
      {
        heading: 'Adding an Expense',
        content: [
          { type: 'steps', items: [
            'Go to Expenses and click + Add Expense.',
            'Select the type (Operation or Admin), date, truck (if operation), category, amount, and description.',
            'Click Save. The expense appears immediately in the list.',
          ]},
        ],
      },
      {
        heading: 'Recurring Expenses',
        content: [
          { type: 'steps', items: [
            'When adding an expense, toggle Recurring to mark it as a template.',
            'At the start of each month, a banner appears: "X recurring expenses found — auto-fill for [month]?"',
            'Click the banner to auto-populate all recurring expenses for that month in one click.',
          ]},
        ],
      },
      {
        heading: 'Amortization & Insurance Schedules',
        content: [
          { type: 'text', text: 'Amortizations and Insurances have their own sub-tabs. Each entry generates a schedule of monthly payments. The system tracks which months have been paid and flags overdue months.' },
        ],
      },
    ],
  },
  {
    id: 'payroll',
    icon: '💼',
    title: 'Employees',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Overview',
        content: [
          { type: 'text', text: 'Employees has 4 top-level tabs: Admin, Support, Drivers, and Cash Advances. Admin and Support use the familiar semi-monthly Payroll Register (cutoffs on the 15th and last day of the month). Drivers use a completely different, trip-based payroll engine — pay is swept directly from actual logged trips rather than a fixed salary.' },
          { type: 'note', text: 'The old standalone Payroll page still exists at a direct link for reference, but Employees is now the actively used module — all new payroll work should happen here.' },
        ],
      },
      {
        heading: 'Admin & Support — Employees and Payroll Register',
        content: [
          { type: 'steps', items: [
            'Go to Employees → Admin or Support tab, click + Add Employee.',
            'Fill in Full Name, Position, Monthly Basic Rate, Monthly Allowance, and monthly SSS/PhilHealth/HDMF employee shares.',
            'To add a payroll entry: select the cutoff period, click + Add Entry, select the employee — with Auto-calculate on, Basic Salary/Allowance/premiums fill in automatically.',
            'Adjust OT Hours, Rest Day Duty, Salary Adjustment, and Cash Advance Deduction as needed. OT Pay auto-computes as OT Hours × OT Rate as you type, and can still be overridden manually.',
            'The live preview shows Earnings / Deductions / Net Pay before saving.',
          ]},
          { type: 'note', text: 'A 📋 Copy → [next cutoff] button appears once a cutoff has entries — duplicates everything to the next period, zeroing out one-time items (OT, rest day, salary adjustment, CA deduction) while carrying over standard items (basic salary, premiums, loans).' },
        ],
      },
      {
        heading: 'Drivers — Roster, Rates, Loans, and Contribution Brackets',
        content: [
          { type: 'text', text: 'Everything about a driver as a person and how they get paid lives in Employees → Drivers, in 5 sub-tabs.' },
          { type: 'table', rows: [
            ['Sub-tab', 'What it does'],
            ['📋 Payroll Register', 'The actual trip-sweep computation for a chosen cutoff period — see below.'],
            ['🚛 Roster', 'Add/edit drivers: name, assigned truck, SSS/PhilHealth/HDMF numbers, hire date, default pay type (fixed or percentage) and rate.'],
            ['💰 Rates', 'Optional per-route or per-trip-code pay rules — lets one driver be fixed-rate on some routes and percentage-based on others. A blank route/trip code row is that driver\'s catch-all default.'],
            ['🏦 Loans', 'SSS, HDMF (Pag-ibig), or company loans — principal, amortization per cutoff, and running balance, deducted automatically once a payroll entry is locked.'],
            ['⚙️ Contribution Brackets', 'The SSS/PhilHealth/HDMF salary-bracket tables used to compute government contribution deductions — editable in-app, empty until real figures are entered.'],
          ]},
        ],
      },
      {
        heading: 'Computing a Driver\'s Payroll for a Cutoff',
        content: [
          { type: 'steps', items: [
            'Go to Drivers → 📋 Payroll Register, set the period From/To (or pick a previously used coverage from the dropdown).',
            'Click Compute next to a driver — the system automatically sweeps every trip (Dump and Prime Mover) assigned to that driver that hasn\'t already been paid out in any prior cutoff, regardless of the trip\'s own date.',
            'Pay per trip is resolved from that driver\'s Rates config (route/trip-code specific rules first, falling back to their roster default) — fixed amount or a percentage of the trip\'s gross.',
            'Government contributions (SSS/PhilHealth/HDMF) are looked up automatically from the Contribution Brackets against the computed gross.',
            'Review the trip breakdown, adjust or add an Extra Amount with a reason if needed, set the Cash Advance deduction (available balance is shown), then Save.',
            'Once you\'re satisfied the cutoff is final, click Lock — this deducts loan amortizations from balances, records the CA deduction, and finalizes the payslip. Locked entries can no longer be edited.',
          ]},
          { type: 'note', text: 'A trip is swept exactly once, ever — even a late-encoded trip from a prior period lands in whichever cutoff is currently open rather than getting lost or requiring you to reopen a closed period.' },
        ],
      },
      {
        heading: 'Cash Advances',
        content: [
          { type: 'steps', items: [
            'Go to Employees → Cash Advances — this ledger is shared across Admin, Support, and Drivers.',
            'Click + Add Record to log a cash advance (↑ Advance) or a manual payment (↓ Payment), selecting either an employee or a driver.',
            'The running balance is computed automatically, including deductions made through either payroll register (Admin/Support or Drivers).',
          ]},
        ],
      },
      {
        heading: '13th Month Pay — Two Separate Systems',
        content: [
          { type: 'text', text: 'Admin staff keep the existing PD 851 formula system (Total Basic Salary Earned ÷ 12) under Employees → Admin → 13th Month, unchanged from before.' },
          { type: 'text', text: 'Drivers and Support staff use a different, tenure-tiered system instead — go to the Tenure 13th Month section. Tenure (months employed, as of Dec 31) and tier are shown for reference only. The actual amount is always a direct entry, since that\'s upper management\'s decision, not something a formula should output.' },
          { type: 'steps', items: [
            'Select the year, then type the amount decided on for each driver/support staff member.',
            'Click Save (or Update) — the tenure and tier shown alongside are informational only and don\'t drive the number.',
            'Once paid, click Mark Paid to record the payment date.',
          ]},
        ],
      },
      {
        heading: 'Payslips',
        content: [
          { type: 'text', text: 'Drivers get an added Trip Details table above the earnings section on their payslip, showing each trip that was swept into that cutoff. Admin/Support payslips follow the same layout without the trip table.' },
          { type: 'note', text: 'Payslips print through the Signatory Picker, same as other documents — select who Prepared/Approved before printing.' },
        ],
      },
    ],
  },
  {
    id: 'reports',
    icon: '📊',
    title: 'Reports',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Report Modes',
        content: [
          { type: 'table', rows: [
            ['Mode', 'What It Shows'],
            ['Management Report', 'Revenue, expenses, net profit per truck and fleet total'],
            ['Bookkeeper Report', 'Same but includes amortization, insurance, and admin expense splits'],
            ['Per-Client Profitability', 'Revenue breakdown by client across the selected period'],
          ]},
        ],
      },
      {
        heading: 'Generating a Report',
        content: [
          { type: 'steps', items: [
            'Select the Report Mode, then choose a date range or month.',
            'The report generates automatically — no button needed.',
            'To print as PDF, click Save as PDF and select signatories in the dialog.',
            'To export to Excel, click Export Excel.',
          ]},
        ],
      },
      {
        heading: 'Year-over-Year',
        content: [
          { type: 'text', text: 'Year-over-Year (under Finance menu) compares revenue, expenses, and net profit across multiple years side by side. Useful for spotting trends and presenting to management.' },
        ],
      },
      {
        heading: 'Fuel Analytics (Summary page)',
        content: [
          { type: 'text', text: 'On the Overall Summary page, switch to the "⛽ Fuel Analytics" tab to see fuel efficiency per truck — company-owned trucks only (sub-contractor trucks are excluded).' },
          { type: 'steps', items: [
            'Fuel cost is pulled from Expenses (categories: Fuel — PO and Fuel — Cash), matched per truck.',
            'Tons hauled comes from Dump Truck trips; trip count includes both Dump Truck and Prime Mover.',
            'The table shows ₱/Ton and ₱/Trip per truck, plus a fleet-wide total row — useful for spotting trucks with rising fuel costs relative to output.',
            'Use the search box to filter by plate or truck type, and the Month dropdown to narrow to a specific month (or leave blank for all-time).',
          ]},
        ],
      },
    ],
  },
  {
    id: 'subcon',
    icon: '🤝',
    title: 'Sub-con Trips',
    roles: ['staff', 'admin', 'superuser'],
    sections: [
      {
        heading: 'Overview',
        content: [
          { type: 'text', text: 'Sub-con Trips tracks trips made by sub-contracted (partner-owned) trucks that are billed through your company\'s invoices. It has two modes: Regular (you keep a cut, subcon gets a cost) and Special (expense-sharing arrangement).' },
          { type: 'table', rows: [
            ['Mode', 'How profit/share works'],
            ['Regular', 'DS Billing − Subcon Cost = Profit (DS keeps the difference)'],
            ['Special', 'DS Billing − Expense Share = Net Credited to subcon'],
          ]},
        ],
      },
      {
        heading: 'Recording Subcon Costs',
        content: [
          { type: 'steps', items: [
            'Trips for subcon-owned plates appear automatically (pulled from Trips/Billing).',
            'Click ✏️ on a trip to enter Subcon Cost (Regular) or Expense Share (Special), mark Subcon Paid / Client Paid, and add a Voucher No.',
          ]},
        ],
      },
      {
        heading: 'Printing & Exporting',
        content: [
          { type: 'steps', items: [
            'Filter by month, by a specific invoice, or by credit month.',
            'Both 🖨️ Print PDF and 📊 Export Excel open the Signatory dialog — select Prepared by / Approved by before exporting.',
            'Excel exports include two sheets: "Itemized" (one row per trip) and "Summary by Invoice" (grouped totals), both with company header and signatures — ready to send to the sub-contractor.',
          ]},
        ],
      },
    ],
  },
  {
    id: 'cashflow',
    icon: '💰',
    title: 'Cashflow',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Overview',
        content: [
          { type: 'text', text: 'The Cashflow report shows monthly Cash In vs Cash Out with a 12-month bar chart trend. It pulls data automatically from Billing (collected invoices), Sub-con Trips, Extra Income, Check Vouchers, Amortizations, Insurance, Loan Repayments, and Expenses.' },
        ],
      },
      {
        heading: 'Payroll in Cashflow',
        content: [
          { type: 'note', text: 'Payroll is entered manually in Cashflow because the actual cash out includes items not yet in the system (13th month, bonuses, government remittances). Add payroll cash out as a manual entry in the Check Vouchers or as a Cashflow adjustment.' },
        ],
      },
    ],
  },
  {
    id: 'vouchers',
    icon: '🖨️',
    title: 'Check & Cash Vouchers',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Check Vouchers',
        content: [
          { type: 'text', text: 'Check Vouchers generates PH-format check vouchers for printing. Fill in payee, amount, account details, and description. The printed output follows standard Philippine accounting voucher format.' },
        ],
      },
      {
        heading: 'Cash Vouchers',
        content: [
          { type: 'text', text: 'Cash Vouchers tracks petty cash disbursements. Each entry records the payee, amount, purpose, date, and Received By (recipient name).' },
          { type: 'steps', items: [
            'Fill in Voucher No., Date, Payee, Amount, Purpose, and Received By, then save.',
            'Click 🖨️ Print to open the Signatory dialog, then generate the PDF.',
            'The printed voucher shows "Amount in Words" spelled out (e.g. TWENTY-ONE THOUSAND PESOS ONLY), and includes a "Received By" signature line with the recipient\'s name printed above it for them to sign.',
            'Prepared by / Approved by signatures (from the dialog) appear below the Received By line.',
          ]},
        ],
      },
    ],
  },
  {
    id: 'loans',
    icon: '🏦',
    title: 'Loans',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Adding a Loan',
        content: [
          { type: 'steps', items: [
            'Go to Loans and click + Add Loan.',
            'Fill in: Lender, Principal Amount, Interest Rate, Term (months), Start Date.',
            'The system computes the monthly amortization and total payable.',
            'Click Save.',
          ]},
        ],
      },
      {
        heading: 'Tracking Payments',
        content: [
          { type: 'text', text: 'Each loan shows the outstanding balance and payment schedule. Monthly loan payments also appear as expenses in the Expenses module when recorded, feeding into the P&L and Cashflow.' },
        ],
      },
      {
        heading: 'Company Lending',
        content: [
          { type: 'text', text: 'A separate "Lending" tab tracks loans the company gives out (e.g. to employees or partners), with its own amortization schedule.' },
          { type: 'steps', items: [
            'Go to Loans → Lending tab, click + Add to record a new lending with principal, interest rate, and term.',
            'Expand a record and click "Record Payment" to log amortization payments.',
            'Click 🖨️ Print or 📊 Excel to export the schedule — the printed PDF now includes the full company header (name, TIN, address, contact) and an "AMORTIZATION SCHEDULE" title.',
          ]},
        ],
      },
    ],
  },
  {
    id: 'orcr',
    icon: '🚗',
    title: 'OR/CR Tracking',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Overview',
        content: [
          { type: 'text', text: 'OR/CR Tracking monitors the Official Receipt (OR) and Certificate of Registration (CR) expiry for each truck. The system flags trucks with upcoming or lapsed renewals so you never miss an LTO deadline.' },
        ],
      },
      {
        heading: 'Adding a Record',
        content: [
          { type: 'steps', items: [
            'Go to OR/CR Tracking and click + Add.',
            'Select the truck and enter the OR number, CR number, and expiry date.',
            'Save. The dashboard will highlight trucks nearing expiry.',
          ]},
        ],
      },
      {
        heading: 'Editing a Record',
        content: [
          { type: 'steps', items: [
            'Click ✏️ next to the record to update.',
            'Update OR/CR numbers or expiry date, then click Save.',
          ]},
        ],
      },
      {
        heading: 'Deleting a Record',
        content: [
          { type: 'steps', items: [
            'Click Del next to the record and confirm in the dialog.',
            'The record is permanently removed — no trash/restore for OR/CR records.',
          ]},
          { type: 'note', text: 'Only admin and superuser can delete OR/CR records.' },
        ],
      },
    ],
  },
  {
    id: 'settings',
    icon: '⚙️',
    title: 'Settings',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Tabs Overview',
        content: [
          { type: 'table', rows: [
            ['Tab', 'What You Can Do'],
            ['Company Info', 'Company name, address, TIN, contact, email'],
            ['Signatories', 'Add/edit people who sign documents (appears in signatory picker when printing)'],
            ['Trucks', 'Add/edit/deactivate trucks in the fleet'],
            ['Clientele', 'Add/edit clients, their billing details, and Prime Mover Trip Entry Style (Container/Port or Generic Van)'],
            ['Commodities', 'Add/edit commodity types used in trip entry'],
            ['Routes', 'Add/remove custom Dump Truck routes — appear in Trip Entry and Manage Trips filter'],
            ['PM Trip Codes', 'Add custom Prime Mover trip codes (e.g. for a new client) — no schema change needed, works for both Container and Van style clients'],
            ['Legal', 'View the End User License Agreement, Privacy Policy, and DMCA / Copyright Policy'],
            ['PWA Icons', 'Superuser only — app icon for install-to-homescreen'],
          ]},
        ],
      },
      {
        heading: 'Managing Routes',
        content: [
          { type: 'text', text: 'Dump Truck trips use a Route field (e.g. CDO-Davao, Lagonglong-Davao). Some routes are always available; you can add more from here.' },
          { type: 'steps', items: [
            'Go to Settings → Routes.',
            'Type the new route name (e.g. "Butuan-Davao") and click Add, or press Enter.',
            'New routes appear immediately in the Route dropdown on Trip Entry and the route filter in Manage Trips.',
            'Click the × on any route pill to remove it.',
          ]},
          { type: 'note', text: 'The full list of built-in routes is shown under Settings → Routes for reference — they are always available and cannot be removed; only custom-added routes can be deleted.' },
        ],
      },
      {
        heading: 'Managing PM Trip Codes',
        content: [
          { type: 'text', text: 'Prime Mover trips use a Trip Code to identify which client/billing arrangement a trip belongs to (e.g. SMC, Hustling PSACC). The built-in codes always work; add more here whenever a new Prime Mover client comes on board.' },
          { type: 'steps', items: [
            'Go to Settings → PM Trip Codes.',
            'Type the new code (usually the client name) and click Add, or press Enter.',
            'New codes appear immediately in the Trip Code dropdown on Trip Entry, for both Container/Port and Generic Van style clients.',
            'Click the × on any custom code pill to remove it — built-in codes cannot be removed.',
          ]},
        ],
      },
      {
        heading: 'Adding a Signatory',
        content: [
          { type: 'steps', items: [
            'Go to Settings → Signatories.',
            'Click + Add Signatory.',
            'Enter the full name, title/position, and which documents they sign (SOA, Reports, Payroll, etc.).',
            'Save. They will appear in the signatory picker dialog when printing any document.',
          ]},
        ],
      },
    ],
  },
  {
    id: 'users',
    icon: '👥',
    title: 'Manage Users',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Overview',
        content: [
          { type: 'text', text: 'Admin and Superuser can manage users. Staff and Admin accounts can be created by either role — only Superuser can grant the Superuser role itself.' },
        ],
      },
      {
        heading: 'Creating a User',
        content: [
          { type: 'steps', items: [
            'Go to Manage Users and click + Add User.',
            'Enter full name, email, role (staff or admin), and a temporary password.',
            'Optionally set an Override PIN (format: 1 letter + 5 numbers, e.g. A12345) for admin-gated actions.',
            'Save. The user can log in immediately with the temporary password and change it in My Account.',
          ]},
        ],
      },
      {
        heading: 'Changing a Password',
        content: [
          { type: 'steps', items: [
            'Click ✏️ on a user.',
            'Enter a new password in the New Password field.',
            'Leave blank to keep the existing password.',
            'Save.',
          ]},
        ],
      },
    ],
  },
  {
    id: 'logs',
    icon: '📋',
    title: 'Activity Logs',
    roles: ['superuser'],
    sections: [
      {
        heading: 'Tabs',
        content: [
          { type: 'table', rows: [
            ['Tab', 'What It Shows'],
            ['Login Logs', 'Every login attempt — success or failure, device, browser, timestamp'],
            ['Audit Trail — Changes', 'All create/update actions across all modules with user name'],
            ['Audit Trail — Deletes', 'All delete actions — what was deleted, who, when'],
          ]},
        ],
      },
      {
        heading: 'Filtering Logs',
        content: [
          { type: 'text', text: 'Use the search box to filter by user name, module, or action. Use the date range picker to narrow to a specific period. Logs can be exported to Excel or printed.' },
        ],
      },
      {
        heading: 'Log Retention',
        content: [
          { type: 'note', text: 'Auto-purge can be configured in Settings (superuser). Options: 3 months, 6 months, 1 year, 2 years, or forever. When enabled, logs older than the retention period are deleted automatically on login.' },
        ],
      },
    ],
  },
  {
    id: 'backup',
    icon: '💾',
    title: 'DB Backup',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Exporting a Backup',
        content: [
          { type: 'steps', items: [
            'Go to DB Backup and click Export All to Excel.',
            'The system exports every table to a single Excel file — one sheet per table.',
            'Save the file to a USB drive, NAS, or Google Drive.',
            'Recommended: export at least once a week.',
          ]},
        ],
      },
      {
        heading: 'Restoring from Backup',
        content: [
          { type: 'steps', items: [
            'Superuser only — the Import/Restore section is hidden from admin.',
            'Click Show to reveal the import section.',
            'Click Select Backup Excel File and choose the .xlsx backup file.',
            'Review the preview — it shows how many records will be added per table.',
            'Click Confirm Import. Existing records (same ID) are skipped — no data is overwritten.',
          ]},
          { type: 'note', text: 'Always export a fresh backup before importing. Import only adds new records — it never deletes or overwrites.' },
        ],
      },
    ],
  },
  {
    id: 'my-account',
    icon: '👤',
    title: 'My Account',
    roles: ['staff', 'admin', 'superuser'],
    sections: [
      {
        heading: 'What You Can Do',
        content: [
          { type: 'steps', items: [
            'Change your display name.',
            'Change your password — enter your current password, then the new one twice.',
            'View your role and last login.',
          ]},
        ],
      },
    ],
  },
  {
    id: 'trash',
    icon: '🗑️',
    title: 'Trash',
    roles: ['admin', 'superuser'],
    sections: [
      {
        heading: 'Overview',
        content: [
          { type: 'text', text: 'Deleted trips and expenses are soft-deleted and moved to Trash. They can be restored within 30 days. After 30 days they are permanently deleted.' },
        ],
      },
      {
        heading: 'Restoring an Item',
        content: [
          { type: 'steps', items: [
            'Go to Trash.',
            'Find the item and click Restore.',
            'The item returns to its original module immediately.',
          ]},
        ],
      },
    ],
  },
]

// ── ROLE ORDER for filtering ──────────────────────────────────────────────────
const ROLE_RANK = { staff: 1, admin: 2, superuser: 3 }

// ── CONTENT RENDERERS ─────────────────────────────────────────────────────────
function RenderContent({ items }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {items.map((item, i) => {
        if (item.type === 'text') {
          return <p key={i} style={{ margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>{item.text}</p>
        }
        if (item.type === 'note') {
          return (
            <div key={i} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderLeft: '3px solid var(--accent)', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
              💡 {item.text}
            </div>
          )
        }
        if (item.type === 'steps') {
          return (
            <ol key={i} style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
              {item.items.map((step, j) => (
                <li key={j} style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--text)' }}>{step}</li>
              ))}
            </ol>
          )
        }
        if (item.type === 'table') {
          const [header, ...rows] = item.rows
          return (
            <div key={i} style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    {header.map((h, j) => (
                      <th key={j} style={{ padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border)', textAlign: 'left', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', fontSize: 11, letterSpacing: '.04em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td key={k} style={{ padding: '6px 10px', border: '1px solid var(--border)', fontSize: 13, verticalAlign: 'top', lineHeight: 1.5 }}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
        return null
      })}
    </div>
  )
}

// ── MAIN COMPONENT ────────────────────────────────────────────────────────────
export default function HowTo() {
  const { profile } = useAuth()
  const userRole = profile?.role || 'staff'
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState(null)
  const [showRoleFilter, setShowRoleFilter] = useState('all') // 'all' | 'mine'

  // Filter guides by role and search
  const visibleGuides = useMemo(() => {
    const roleRank = ROLE_RANK[userRole] || 1
    return GUIDES.filter(g => {
      // Role filter
      const accessible = g.roles.some(r => ROLE_RANK[r] <= roleRank)
      if (!accessible) return false
      if (showRoleFilter === 'mine') {
        if (!g.roles.includes(userRole) && !g.roles.includes('staff')) return false
      }
      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase()
        const inTitle = g.title.toLowerCase().includes(q)
        const inSections = g.sections.some(s =>
          s.heading.toLowerCase().includes(q) ||
          s.content.some(c =>
            (c.text || '').toLowerCase().includes(q) ||
            (c.items || []).some(i => i.toLowerCase().includes(q)) ||
            (c.rows || []).flat().some(r => r.toLowerCase().includes(q))
          )
        )
        return inTitle || inSections
      }
      return true
    })
  }, [userRole, search, showRoleFilter])

  const activeGuide = visibleGuides.find(g => g.id === activeId) || visibleGuides[0]

  const roleBadge = (roles) => {
    if (roles.includes('superuser') && roles.length === 1) return { label: 'Superuser only', color: '#7c3aed', bg: '#f5f3ff' }
    if (roles.includes('admin') && !roles.includes('staff')) return { label: 'Admin+', color: '#d97706', bg: '#fffbeb' }
    return { label: 'All users', color: '#16a34a', bg: '#f0fdf4' }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">📖 How-To Guide</h1>
          <p className="page-sub">Click any module to expand its guide</p>
        </div>
      </div>

      {/* Search + filter bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search guides…"
          style={{ flex: 1, minWidth: 200, padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontSize: 13 }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          {["all", "mine"].map(f => (
            <button key={f} onClick={() => setShowRoleFilter(f)}
              style={{ padding: "7px 14px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 12, cursor: "pointer", fontWeight: showRoleFilter === f ? 700 : 400, background: showRoleFilter === f ? "var(--accent)" : "var(--surface)", color: showRoleFilter === f ? "#fff" : "var(--text)" }}>
              {f === "all" ? "All Modules" : "My Role Only"}
            </button>
          ))}
        </div>
      </div>

      {/* Accordion grid */}
      {visibleGuides.length === 0 && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--muted)", fontSize: 13 }}>No guides match your search.</div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
        {visibleGuides.map(g => {
          const isOpen = activeId === g.id
          const badge = roleBadge(g.roles)
          return (
            <div key={g.id} style={{ gridColumn: isOpen ? "1 / -1" : undefined }}>
              {/* Card header — always visible */}
              <button onClick={() => setActiveId(isOpen ? null : g.id)}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: isOpen ? "var(--accent)" : "var(--surface)", color: isOpen ? "#fff" : "var(--text)", border: isOpen ? "none" : "1px solid var(--border)", borderRadius: isOpen ? "8px 8px 0 0" : 8, cursor: "pointer", textAlign: "left", transition: "background .15s" }}>
                <span style={{ fontSize: 22, flexShrink: 0 }}>{g.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{g.title}</div>
                  <div style={{ fontSize: 11, marginTop: 2, color: isOpen ? "rgba(255,255,255,0.75)" : badge.color }}>{badge.label}</div>
                </div>
                <span style={{ fontSize: 18, color: isOpen ? "rgba(255,255,255,0.8)" : "var(--muted)", transition: "transform .2s", transform: isOpen ? "rotate(180deg)" : "rotate(0deg)" }}>⌄</span>
              </button>

              {/* Expanded content */}
              {isOpen && (
                <div style={{ background: "var(--surface)", border: "1px solid var(--accent)", borderTop: "none", borderRadius: "0 0 8px 8px", padding: "20px 24px" }}>
                  <div style={{ display: "grid", gap: 24 }}>
                    {g.sections.map((sec, i) => (
                      <div key={i}>
                        <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 700, color: "var(--text)", paddingBottom: 6, borderBottom: "1px solid var(--border)" }}>
                          {sec.heading}
                        </h3>
                        <RenderContent items={sec.content} />
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setActiveId(null)}
                    style={{ marginTop: 20, padding: "7px 16px", border: "1px solid var(--border)", borderRadius: 6, background: "transparent", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}>
                    ↑ Close
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
