// Legal document content for Settings → Legal tab.
// NOTE: These are template documents drafted for general compliance with
// Philippine law (Intellectual Property Code, RA 8293; Data Privacy Act of
// 2012, RA 10173) and common international norms (GDPR-aware data language,
// US DMCA-style notice-and-takedown procedure). They are NOT a substitute
// for review by a licensed Philippine attorney before relying on them as
// binding legal protection for an operating business.

const LAST_UPDATED = 'August 2026'

export const EULA_SECTIONS = [
  {
    heading: '1. Acceptance of Terms',
    body: [
      'This End User License Agreement ("Agreement") is a binding agreement between the operating company using this Fleet Management System (the "Licensee") and its authorized users (each, a "User", collectively "Users") on one hand, and the developer and licensor of the System (the "Licensor") on the other.',
      'By accessing or using the System — including logging in, entering data, generating reports, or otherwise interacting with it in any capacity — you acknowledge that you have read, understood, and agree to be bound by this Agreement. If you do not agree, do not access or use the System.',
    ],
  },
  {
    heading: '2. Grant of License',
    body: [
      'Subject to the terms of this Agreement and any separate written agreement between the Licensee and the Licensor, the Licensor grants the Licensee a limited, non-exclusive, non-transferable, non-sublicensable license to access and use the System solely for the Licensee\'s internal business operations.',
      'This license does not constitute a sale of the System or any part of it. All rights not expressly granted are reserved by the Licensor.',
    ],
  },
  {
    heading: '3. Ownership and Intellectual Property',
    body: [
      'The System, including its source code, structure, design, database schema, and underlying architecture, is the intellectual property of the Licensor and is protected under the Intellectual Property Code of the Philippines (Republic Act No. 8293) and applicable international copyright treaties, including the Berne Convention.',
      'Data entered into the System by the Licensee (trip records, billing information, employee records, and similar business data) remains the sole property of the Licensee. The Licensor claims no ownership over Licensee-generated data.',
      'Any trademarks, logos, or business names displayed within the System belong to their respective owners and are used solely to identify the Licensee\'s business within its own instance of the System.',
    ],
  },
  {
    heading: '4. Restrictions',
    body: [
      'Users may not: (a) copy, modify, or create derivative works of the System\'s source code without written authorization; (b) reverse engineer, decompile, or disassemble the System except to the extent such restriction is prohibited by applicable law; (c) share login credentials with unauthorized persons; (d) use the System for any unlawful purpose or in violation of any applicable law or regulation; or (e) attempt to gain unauthorized access to any portion of the System not granted to that User\'s role.',
    ],
  },
  {
    heading: '5. User Accounts and Responsibilities',
    body: [
      'Each User is responsible for maintaining the confidentiality of their login credentials and for all activity that occurs under their account. The Licensee is responsible for promptly notifying the Licensor of any suspected unauthorized access.',
      'User roles (Staff, Admin, Superuser, Viewer) determine the scope of data and functionality accessible to each User. Users must not attempt to circumvent these role-based restrictions.',
    ],
  },
  {
    heading: '6. Data Privacy and Protection',
    body: [
      'The System processes personal data (including employee names, contact details, and payroll information) in the course of normal business operations. The Licensee acts as the personal information controller for such data under the Data Privacy Act of 2012 (Republic Act No. 10173) and is responsible for ensuring a lawful basis for processing, honoring data subject rights, and complying with any applicable National Privacy Commission (NPC) issuances.',
      'The Licensor and its infrastructure providers (including database and hosting providers) act as personal information processors and implement reasonable organizational, physical, and technical security measures to protect data against unauthorized access, alteration, disclosure, or destruction.',
      'For Users or data subjects located outside the Philippines, the Licensee is responsible for ensuring compliance with any additional applicable data protection law in their jurisdiction (such as the EU General Data Protection Regulation or comparable frameworks), to the extent such laws apply to the Licensee\'s operations.',
      'Data subjects may exercise applicable rights (such as access, correction, or deletion of their personal data) by contacting the Licensee directly, as the Licensee controls the underlying business data.',
    ],
  },
  {
    heading: '7. Third-Party Services',
    body: [
      'The System relies on third-party infrastructure providers for hosting, database, and authentication services. Use of the System is also subject to the applicable terms of service and privacy policies of those providers. The Licensor is not responsible for outages, data handling practices, or policy changes originating from third-party infrastructure providers, though the Licensor will make reasonable efforts to notify the Licensee of any material impact.',
    ],
  },
  {
    heading: '8. Warranty Disclaimer',
    body: [
      'THE SYSTEM IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTY OF ANY KIND, WHETHER EXPRESS, IMPLIED, OR STATUTORY, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT, EXCEPT WHERE SUCH DISCLAIMER IS PROHIBITED BY APPLICABLE LAW, INCLUDING THE CONSUMER ACT OF THE PHILIPPINES (REPUBLIC ACT NO. 7394) WHERE APPLICABLE.',
      'The Licensor does not warrant that the System will be uninterrupted, error-free, or free of harmful components.',
    ],
  },
  {
    heading: '9. Limitation of Liability',
    body: [
      'TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, THE LICENSOR SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, OR BUSINESS OPPORTUNITY, ARISING OUT OF OR RELATED TO THE USE OF OR INABILITY TO USE THE SYSTEM, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.',
      'Nothing in this Agreement limits liability for fraud, gross negligence, or any other liability that cannot be limited or excluded under applicable Philippine law.',
    ],
  },
  {
    heading: '10. Indemnification',
    body: [
      'The Licensee agrees to indemnify and hold harmless the Licensor from any claims, damages, losses, or expenses (including reasonable attorney\'s fees) arising from the Licensee\'s or its Users\' misuse of the System, violation of this Agreement, or violation of applicable law.',
    ],
  },
  {
    heading: '11. Term and Termination',
    body: [
      'This Agreement remains in effect for as long as the Licensee uses the System, or as otherwise specified in a separate written agreement between the parties. Either party may terminate access under the terms of any separate service or implementation agreement. Upon termination, the Licensee\'s right to access the System ceases, though the Licensee retains ownership of and rights to export its own business data, subject to the terms of any separate agreement.',
    ],
  },
  {
    heading: '12. Governing Law and Dispute Resolution',
    body: [
      'This Agreement is governed by the laws of the Republic of the Philippines, without regard to conflict-of-law principles. Any dispute arising from this Agreement shall first be addressed through good-faith negotiation between the parties, and if unresolved, shall be subject to the exclusive jurisdiction of the appropriate courts of the Philippines.',
      'For Users accessing the System from outside the Philippines, this governing law clause applies to the extent permitted by the User\'s local law; nothing in this Agreement is intended to override any non-waivable consumer or data protection right available under a User\'s local law.',
    ],
  },
  {
    heading: '13. Severability',
    body: [
      'If any provision of this Agreement is found to be unenforceable or invalid under applicable law, that provision shall be limited or eliminated to the minimum extent necessary, and the remaining provisions shall remain in full force and effect.',
    ],
  },
  {
    heading: '14. Amendments',
    body: [
      'The Licensor may update this Agreement from time to time. Material changes will be reflected by an updated "Last Updated" date on this page. Continued use of the System after such changes constitutes acceptance of the revised Agreement.',
    ],
  },
  {
    heading: '15. Contact',
    body: [
      'Questions about this Agreement may be directed to the system administrator through the contact details listed in Settings → Company Info.',
    ],
  },
]

export const DMCA_SECTIONS = [
  {
    heading: '1. Purpose and Scope',
    body: [
      'This Copyright and Intellectual Property Infringement Policy ("Policy") sets out the procedure for reporting claims of copyright or intellectual property infringement in connection with content stored, displayed, or generated within this Fleet Management System (the "System").',
      'The System is primarily an internal business tool for authorized personnel and is not a public content-sharing platform. This Policy is adopted voluntarily, drawing on the notice-and-takedown framework of the United States Digital Millennium Copyright Act (DMCA, 17 U.S.C. § 512) as a widely recognized good-practice standard, and applies alongside the intellectual property enforcement mechanisms available under the Intellectual Property Code of the Philippines (Republic Act No. 8293) through the Intellectual Property Office of the Philippines (IPOPHL).',
      'This Policy covers content that may be uploaded to the System by authorized Users, such as company logos, document templates, or attached files, to the extent such content is capable of infringing the rights of a third party.',
    ],
  },
  {
    heading: '2. Respect for Intellectual Property Rights',
    body: [
      'The operator of this System respects the intellectual property rights of others and expects Users of the System to do the same. Users may only upload or submit content that they own, have proper authorization to use, or that otherwise does not infringe the intellectual property rights of any third party.',
    ],
  },
  {
    heading: '3. Filing a Notice of Infringement',
    body: [
      'If you believe that content within the System infringes your copyright or other intellectual property right, you may submit a written notice to the designated contact listed in Section 6, containing the following information:',
      '(a) A physical or electronic signature of the person authorized to act on behalf of the owner of the exclusive right that is allegedly infringed;',
      '(b) Identification of the copyrighted work or intellectual property right claimed to have been infringed;',
      '(c) Identification of the material claimed to be infringing, with sufficient detail to allow it to be located within the System;',
      '(d) Your contact information, including address, telephone number, and email address;',
      '(e) A statement that you have a good faith belief that use of the material in the manner complained of is not authorized by the copyright or rights owner, its agent, or the law; and',
      '(f) A statement, made under penalty of perjury, that the information in the notice is accurate and that you are the owner of the exclusive right that is allegedly infringed, or are authorized to act on that owner\'s behalf.',
    ],
  },
  {
    heading: '4. Counter-Notification',
    body: [
      'A User whose content has been removed or disabled in response to a notice may submit a counter-notification containing: (a) their physical or electronic signature; (b) identification of the material removed and its location before removal; (c) a statement under penalty of perjury that the material was removed as a result of mistake or misidentification; and (d) their name, address, and telephone number, along with a statement consenting to the jurisdiction of the appropriate Philippine courts.',
    ],
  },
  {
    heading: '5. Repeat Infringer Policy',
    body: [
      'Users who are determined, in appropriate circumstances, to be repeat infringers of third-party intellectual property rights may have their access to the System suspended or terminated at the discretion of the System administrator.',
    ],
  },
  {
    heading: '6. Designated Contact',
    body: [
      'Notices under this Policy should be directed to the system administrator through the contact details listed in Settings → Company Info.',
    ],
  },
  {
    heading: '7. False Claims',
    body: [
      'Submitting a knowingly false or materially misleading notice of infringement may result in liability for damages under applicable law, including costs and attorney\'s fees.',
    ],
  },
  {
    heading: '8. Modifications',
    body: [
      'This Policy may be updated from time to time. Material changes will be reflected by an updated "Last Updated" date on this page.',
    ],
  },
]

export const PRIVACY_SECTIONS = [
  {
    heading: '1. Introduction and Scope',
    body: [
      'This Privacy Policy describes how the operating company using this Fleet Management System (the "Company") collects, uses, stores, and protects personal data processed through the System, in compliance with the Data Privacy Act of 2012 (Republic Act No. 10173) and its Implementing Rules and Regulations, as administered by the National Privacy Commission (NPC).',
      'This Policy applies to personal data of employees, drivers, and other individuals whose information is entered into or processed by the System in the course of the Company\'s business operations. It does not apply to data the Company processes through means outside this System.',
    ],
  },
  {
    heading: '2. The Company as Personal Information Controller',
    body: [
      'The Company is the Personal Information Controller (PIC) for personal data processed through the System — meaning the Company decides why and how such data is collected and used. The System\'s software developer and infrastructure providers act as Personal Information Processors (PIPs), processing data only on the Company\'s instructions and for the purposes described in this Policy.',
    ],
  },
  {
    heading: '3. What Personal Data Is Collected',
    body: [
      'Depending on your relationship with the Company, the System may process: full name, contact number, email address, and home address; employment details such as position, salary, and work schedule; government-mandated contribution numbers (SSS, PhilHealth, Pag-IBIG/HDMF) for payroll compliance; driver\'s license and vehicle assignment information; login credentials and system activity logs; and financial records related to loans, cash advances, or reimbursements processed through the Company.',
      'Some of this information (such as government-issued identification numbers) may be treated as sensitive under the Data Privacy Act and is handled with corresponding additional care.',
    ],
  },
  {
    heading: '4. Purpose of Collection and Processing',
    body: [
      'Personal data is collected and processed for legitimate business purposes, including: payroll computation and disbursement; compliance with statutory reporting obligations to SSS, PhilHealth, Pag-IBIG, and the Bureau of Internal Revenue; fleet and trip operations management; billing and invoicing; internal audit and record-keeping; and account authentication and access control within the System.',
    ],
  },
  {
    heading: '5. Data Sharing and Disclosure',
    body: [
      'Personal data is not sold or shared with third parties for marketing purposes. Data may be disclosed to: government agencies as required by law (e.g., SSS, PhilHealth, Pag-IBIG, BIR); the System\'s infrastructure providers (database hosting and application hosting services), acting strictly as processors under the Company\'s instructions; and professional advisors (such as auditors or legal counsel) on a need-to-know basis.',
      'Where infrastructure providers store or process data on servers located outside the Philippines, the Company takes reasonable steps to ensure such providers maintain a comparable standard of data protection.',
    ],
  },
  {
    heading: '6. Data Retention',
    body: [
      'Personal data is retained only for as long as necessary to fulfill the purposes described in this Policy, or as required by applicable law (for example, statutory retention periods for payroll and tax records). Data no longer needed is disposed of or anonymized in a secure manner.',
    ],
  },
  {
    heading: '7. Data Subject Rights',
    body: [
      'Under the Data Privacy Act, data subjects have the right to: be informed that their personal data is being processed; access their personal data held by the Company; request correction of inaccurate data; object to processing under certain circumstances; request erasure or blocking of data that is no longer necessary or was unlawfully obtained; data portability, where technically feasible; and be indemnified for damages sustained due to inaccurate, unlawful, or unauthorized processing.',
      'To exercise any of these rights, contact the Company through the details in Section 9. Data subjects also have the right to file a complaint directly with the National Privacy Commission (www.privacy.gov.ph).',
    ],
  },
  {
    heading: '8. Security Measures',
    body: [
      'The Company and its infrastructure providers implement reasonable organizational, physical, and technical security measures to protect personal data, including role-based access control (limiting data visibility by user role), encrypted data transmission, and access logging. No system can guarantee absolute security, but the Company takes reasonable steps to minimize risk and will respond to any known data breach in accordance with NPC breach notification requirements.',
    ],
  },
  {
    heading: '9. Contact and Data Protection Officer',
    body: [
      'Questions, requests, or concerns about this Policy or how personal data is handled should be directed to the individual designated by the Company as its Data Protection Officer (or, if not yet formally designated, to the system administrator), through the contact details listed in Settings → Company Info.',
    ],
  },
  {
    heading: '10. International Data Subjects',
    body: [
      'If personal data of individuals located outside the Philippines is processed through the System (for example, in connection with a client or partner based abroad), the Company will take reasonable steps to honor comparable rights under applicable local law, such as the EU General Data Protection Regulation, to the extent such laws apply to the Company\'s operations.',
    ],
  },
  {
    heading: '11. Changes to This Policy',
    body: [
      'This Policy may be updated from time to time to reflect changes in the Company\'s data practices or applicable law. Material changes will be reflected by an updated "Last Updated" date on this page.',
    ],
  },
]

export const LEGAL_LAST_UPDATED = LAST_UPDATED
