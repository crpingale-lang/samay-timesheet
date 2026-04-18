/**
 * Form 15CB → Form 146 Conversion — API Routes
 * ==============================================
 * Provides:
 *   POST   /api/form15cb/parse            — parse XML, return extracted fields + gaps
 *   POST   /api/form15cb/convert          — assemble Form 146 JSON, save transaction
 *   GET    /api/form15cb/transactions     — list all transactions (with remittee filter)
 *   GET    /api/form15cb/transactions/:id — get single transaction
 *   DELETE /api/form15cb/transactions/:id — delete transaction
 *
 *   GET    /api/form15cb/remitters        — list remitter master
 *   POST   /api/form15cb/remitters        — create remitter
 *   PUT    /api/form15cb/remitters/:id    — update remitter
 *   DELETE /api/form15cb/remitters/:id    — delete remitter
 *
 *   GET    /api/form15cb/remittees        — list remittee master
 *   POST   /api/form15cb/remittees        — create remittee
 *   PUT    /api/form15cb/remittees/:id    — update remittee
 *   DELETE /api/form15cb/remittees/:id    — delete remittee
 *
 *   GET    /api/form15cb/banks            — list bank master
 *   POST   /api/form15cb/banks            — create bank
 *   PUT    /api/form15cb/banks/:id        — update bank
 *   DELETE /api/form15cb/banks/:id        — delete bank
 *
 *   GET    /api/form15cb/partners         — list partner/CA master
 *   POST   /api/form15cb/partners         — create partner
 *   PUT    /api/form15cb/partners/:id     — update partner
 *   DELETE /api/form15cb/partners/:id     — delete partner
 *
 *   GET    /api/form15cb/remittees/:id/history — last 5 transactions for remittee
 *   GET    /api/form15cb/analytics        — dashboard summary stats
 */

'use strict';

const express  = require('express');
const multer   = require('multer');
const { XMLParser } = require('fast-xml-parser');
const { db }   = require('../db');
const router   = express.Router();

// ─── Multer — in-memory storage (no disk writes) ───────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── Firestore collection names ────────────────────────────────────────────
const COL = {
  transactions: 'form15cb_transactions',
  remitters:    'form15cb_remitters',
  remittees:    'form15cb_remittees',
  banks:        'form15cb_banks',
  partners:     'form15cb_partners',
};

// ─────────────────────────────────────────────────────────────────────────────
// LOOKUP TABLES
// ─────────────────────────────────────────────────────────────────────────────

const CURRENCY_CODES = {
  "100":"AED","101":"AFN","102":"ALL","103":"AMD","104":"ANG","105":"AOA",
  "106":"ARS","107":"AUD","108":"AWG","109":"AZN","110":"BAM","111":"BBD",
  "112":"BDT","113":"BGN","114":"BHD","115":"BIF","116":"BMD","117":"BND",
  "118":"BOB","119":"BRL","120":"BSD","121":"BTN","122":"BWP","123":"BYR",
  "124":"BZD","125":"CAD","126":"CDF","127":"CHF","128":"CLP","129":"CNY",
  "130":"COP","131":"CRC","132":"CUP","133":"CVE","134":"CZK","135":"DJF",
  "136":"DKK","137":"DOP","138":"DZD","139":"EGP","140":"ERN","141":"ETB",
  "142":"EUR","143":"FJD","144":"FKP","145":"GBP","146":"GEL","147":"GHS",
  "148":"GIP","149":"GMD","150":"GNF","151":"GTQ","152":"GYD","153":"HKD",
  "154":"HNL","155":"HRK","156":"HTG","157":"HUF","158":"IDR","159":"ILS",
  "160":"INR","161":"IQD","162":"IRR","163":"ISK","164":"JMD","165":"JOD",
  "166":"JPY","167":"USD","168":"KES","169":"KGS","170":"KHR","171":"KMF",
  "172":"KPW","173":"KRW","174":"KWD","175":"KYD","176":"KZT","177":"LAK",
  "178":"LBP","179":"LKR","180":"LRD","181":"LSL","182":"LYD","183":"MAD",
  "184":"MDL","185":"MGA","186":"MKD","187":"MMK","188":"MNT","189":"MOP",
  "190":"MRO","191":"MUR","192":"MVR","193":"MWK","194":"MXN","195":"MYR",
  "196":"MZN","197":"NAD","198":"NGN","199":"NIO","200":"NOK","201":"NPR",
  "202":"NZD","203":"OMR","204":"PAB","205":"PEN","206":"PGK","207":"PHP",
  "208":"PKR","209":"PLN","210":"PYG","211":"QAR","212":"RON","213":"RSD",
  "214":"RUB","215":"RWF","216":"SAR","217":"SBD","218":"SCR","219":"SDG",
  "220":"SEK","221":"SGD","222":"SHP","223":"SLL","224":"SOS","225":"SRD",
  "226":"STD","227":"SVC","228":"SYP","229":"SZL","230":"THB","231":"TJS",
  "232":"TMT","233":"TND","234":"TOP","235":"TRY","236":"TTD","237":"TWD",
  "238":"TZS","239":"UAH","240":"UGX","241":"UYU","242":"UZS","243":"VEF",
  "244":"VND","245":"VUV","246":"WST","247":"XAF","248":"XCD","249":"XOF",
  "250":"XPF","251":"YER","252":"ZAR","253":"ZMW","254":"ZWL",
};

const COUNTRY_CODES = {
  "1":"United States","7":"Russia","20":"Egypt","27":"South Africa","30":"Greece",
  "31":"Netherlands","32":"Belgium","33":"France","34":"Spain","39":"Italy",
  "40":"Romania","41":"Switzerland","43":"Austria","44":"United Kingdom",
  "45":"Denmark","46":"Sweden","47":"Norway","48":"Poland","49":"Germany",
  "52":"Mexico","54":"Argentina","55":"Brazil","56":"Chile","57":"Colombia",
  "60":"Malaysia","61":"Australia","62":"Indonesia","63":"Philippines",
  "64":"New Zealand","65":"Singapore","66":"Thailand","81":"Japan",
  "82":"South Korea","84":"Vietnam","86":"China","90":"Turkey","91":"India",
  "92":"Pakistan","93":"Afghanistan","94":"Sri Lanka","95":"Myanmar","98":"Iran",
  "212":"Morocco","213":"Algeria","216":"Tunisia","218":"Libya","220":"Gambia",
  "234":"Nigeria","254":"Kenya","255":"Tanzania","256":"Uganda",
  "966":"Saudi Arabia","971":"UAE","972":"Israel","973":"Bahrain","974":"Qatar",
  "975":"Bhutan","976":"Mongolia","977":"Nepal","992":"Tajikistan",
  "994":"Azerbaijan","995":"Georgia","996":"Kyrgyzstan","998":"Uzbekistan",
};

const NATURE_REM_MAP = {
  "1":1,"1.1":1,"2":2,"2.1":2,"3":3,"3.1":3,"4":4,"4.1":4,"5":5,"5.1":5,
  "6":6,"6.1":6,"7":7,"7.1":7,"8":8,"8.1":8,"9":9,"9.1":9,"10":10,"10.1":10,
  "11":11,"11.1":11,"12":12,"12.1":12,"13":13,"13.1":13,"14":14,"14.1":14,
  "15":15,"15.1":15,"16":16,"16.1":16,"16.99":16,"17":17,"17.1":17,
  "18":18,"18.1":18,"19":19,"19.1":19,"20":20,"20.1":20,"21":21,
};

const MANDATORY_FIELDS = [
  { key:'form19bf8IFSCcode',      label:'Bank IFSC Code',                    hardcode:'ICIC0000001' },
  { key:'form19bf8RemiteeTIN',    label:'Remittee Tax Identification Number', hardcode:'HARDCODED_TIN' },
  { key:'form19bf8CertPlace',     label:'CA Certification Place (City)',      hardcode:'Mumbai' },
  { key:'form19bf8CertDate',      label:'CA Certification Date',             hardcode: new Date().toISOString().slice(0,10) },
  { key:'form19bf8CertIPAddress', label:'System IP Address',                 hardcode:'0.0.0.0' },
];

const OPTIONAL_FIELDS = [
  { key:'form19bf8RemiteeEmail',    label:'Remittee Email Address' },
  { key:'form19bf8TaxResidNum',     label:'Tax Residency Certificate Number' },
  { key:'form19bf8ArticleReasons',  label:'DTAA Article Reasons' },
  { key:'form19bf8FurnishReasons',  label:'Furnish Reasons' },
  { key:'form19bf8Basis',           label:'Basis for Tax Determination' },
  { key:'form19bf8CertAdd',         label:'CA Additional Certification Note' },
];

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function getCurrency(code) {
  return CURRENCY_CODES[String(code || '').trim()] || null;
}

function getCountryName(code) {
  return COUNTRY_CODES[String(code || '').trim()] || '';
}

function getNatureCode(cat) {
  return NATURE_REM_MAP[String(cat || '').trim()] || null;
}

function extractSubcode(revPurCode) {
  if (!revPurCode) return '';
  const parts = String(revPurCode).split('-');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].startsWith('S') || /^[A-Z0-9]+$/.test(parts[i])) return parts[i];
  }
  return revPurCode;
}

function composeAddress(...parts) {
  return parts.filter(p => p && String(p).trim()).map(p => String(p).trim()).join(', ');
}

function nowISTString() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function taxYear() {
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${fy}-${String(fy + 1).slice(-2)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// XML PARSING
// ─────────────────────────────────────────────────────────────────────────────

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  parseAttributeValue: false,
  trimValues: true,
  isArray: () => false,
});

function parseXml(buffer) {
  const xmlStr = buffer.toString('utf8');
  return xmlParser.parse(xmlStr);
}

// ─────────────────────────────────────────────────────────────────────────────
// FIELD EXTRACTION (port of Python extract_from_xml)
// ─────────────────────────────────────────────────────────────────────────────

function extractFromXml(parsed) {
  const root     = parsed['FORM15CB'] || {};
  const remitter = root['RemitterDetails'] || {};
  const remittee = root['RemitteeDetls']   || {};
  const remit    = root['RemittanceDetails']|| {};
  const itact    = root['ItActDetails']    || {};
  const dtaa     = root['DTAADetails']     || {};
  const tds      = root['TDSDetails']      || {};
  const acctnt   = root['AcctntDetls']     || {};
  const rAddr    = remittee['RemitteeAddrs']|| {};
  const aAddr    = acctnt['AcctntAddrs']   || {};

  const warnings = [];
  const fields   = {};

  const s = v => (v === undefined || v === null) ? '' : String(v);

  // Panel 1 — Remitter
  fields._pan           = s(remitter['PAN']);
  fields._caid          = s(acctnt['MembershipNumber']);
  fields.form19bf8RemitterName = s(remitter['NameRemitter']);

  // Panel 2 — Remittee
  fields.form19bf8RemiteeName  = s(remittee['NameRemittee']);
  fields.form19bf8RemiteeName1 = s(remitter['NameRemitter']); // remitter in remittee panel

  const cCode = s(rAddr['Country']);
  const cName = getCountryName(cCode);
  fields.form19bf8RemiteeCountry = isNaN(parseInt(cCode)) ? cCode : parseInt(cCode);
  fields.form19bf8BusinPlace     = s(rAddr['TownCityDistrict']) || cName;
  fields.form19bf8RemiteeFullAddr = composeAddress(
    rAddr['FlatDoorBuilding'], rAddr['RoadStreet'],
    rAddr['PremisesBuildingVillage'], rAddr['AreaLocality'],
    rAddr['TownCityDistrict'], rAddr['ZipCode']
  );
  fields.tyForm19BF8AddressP2 = {
    country:          parseInt(cCode) || 0,
    addrLine1:        composeAddress(rAddr['FlatDoorBuilding'], rAddr['RoadStreet']),
    addrLine2:        composeAddress(rAddr['PremisesBuildingVillage'], rAddr['AreaLocality']),
    zipcode:          s(rAddr['ZipCode']),
    foreignPostOffice:s(rAddr['TownCityDistrict']),
    foreignLocality:  s(rAddr['AreaLocality']),
    foreignDistrict:  s(rAddr['TownCityDistrict']),
    foreignState:     s(rAddr['State']) || 'STATE OUTSIDE INDIA',
  };

  // Panel 3 — Remittance
  fields.form19bf8RemittaceCntry = s(remit['CountryRemMadeSecb']) || cCode;

  const curCode = s(remit['CurrencySecbCode']);
  const curISO  = getCurrency(curCode);
  if (curISO) {
    fields.form19bf8Currency = curISO;
  } else {
    fields.form19bf8Currency = null;
    if (curCode) warnings.push(`Currency code '${curCode}' not mapped. Select manually.`);
  }

  fields.form19bf8AmtPayableFore  = s(remit['AmtPayForgnRem']);
  fields.form19bf8AmtPayableInd   = s(remit['AmtPayIndRem']);
  fields.form19bf8Branch          = s(remit['BranchName']);
  fields.form19bf8BSRcode         = s(remit['BsrCode']);
  fields.form19bf8ProposedDate    = s(remit['PropDateRem']);
  fields.form19bf8GrossedTax      = s(remit['TaxPayGrossSecb']) || 'N';

  const purCat = s(remit['RevPurCategory']);
  fields.form19bf8Purposecode     = purCat.replace('RB-', '');
  fields.form19bf8Subcode         = extractSubcode(s(remit['RevPurCode']));
  fields.form19bf8Subcode1        = '';   // filled after IFSC bank lookup

  fields.form19bf8NatureRemittance = s(remit['NatureRemCode']);
  const natInt = getNatureCode(s(remit['NatureRemCategory']));
  fields.form19bf8RemittanceName  = natInt;   // may be null

  // Panel 4 — IT Act
  fields.form19bf8RemittanceTax = s(itact['RemittanceCharIndia']) || 'Y';
  fields.form19bf8Taxable       = s(itact['SecRemCovered']).replace('SECTION ', '').trim();
  fields.form19bf8TaxableInc    = s(itact['AmtIncChrgIt']);
  fields.form19bf8TaxLiability  = s(itact['TaxLiablIt']);
  fields.form19bf8Taxdetermine  = s(itact['BasisDeterTax']);

  // Panel 5 — DTAA
  fields.form19bf8ReliefClaimed  = Object.keys(dtaa).length ? 'Y' : 'N';
  fields.form19bf8TaxResidency   = s(dtaa['TaxResidCert'])    || 'N';
  fields.form19bf8Relevant       = s(dtaa['RelevantArtDtaa']);
  fields.form19bf8Article        = s(dtaa['ArtDtaa']);
  fields.form19bf8TaxbleIncome   = s(dtaa['TaxIncDtaa']);
  fields.form19bf8TaxbleLiablity = s(dtaa['TaxLiablDtaa']);
  fields.form19bf8Ratededctax    = s(dtaa['RateTdsADtaa']);
  fields.form19bf8RemitanceAcc   = s(dtaa['RemAcctBusIncFlg']) || 'N';
  fields.form19bf8TaxableIncDTAA = s(dtaa['TaxIndDtaaFlg'])   || 'N';
  fields.form19bf8CaptialGains   = s(dtaa['RemOnCapGainFlg']) || 'N';

  const royFlag = s(dtaa['RemForRoyFlg']);
  fields.form19bf8NaturePayment  = royFlag === 'Y' ? 'Royalty' : s(remit['NatureRemCode']) || 'Fees';
  fields.form19bf8RemittanceDrp  = s(dtaa['IncLiabIndiaFlg']);

  // Panel 6 — TDS
  fields.form19bf8TDSforeign     = s(tds['AmtPayForgnTds']);
  fields.form19bf8TDSIndian      = s(tds['AmtPayIndianTds']);
  fields.form19bf8RateTDS        = s(tds['RateTdsSecB']);
  fields.form19bf8DateAmtTDS     = s(tds['DednDateTds']);
  fields.form19bf8AmtPayableFore1= s(tds['ActlAmtTdsForgn']);
  fields.form19bf8AmountTDS      = s(tds['AmtPayIndianTds']);
  fields.form19bf8OthersTDS      = s(tds['RateTdsSecB']);

  // Panel 7 — CA / Accountant
  fields.form19bf8NameAcc    = s(acctnt['NameAcctnt']);
  fields.form19bf8CAMemberNo = s(acctnt['MembershipNumber']);
  fields.form19f8Namefirm    = s(acctnt['NameFirmAcctnt']);
  fields.form19bf8FirmRegNo  = s(acctnt['RegNoAcctnt']);
  fields.form19bf8RemittanceAddr = composeAddress(
    aAddr['FlatDoorBuilding'], aAddr['PremisesBuildingVillage'],
    aAddr['AreaLocality'], aAddr['TownCityDistrict']
  );

  let pin = 0, state = 0;
  try { pin   = parseInt(aAddr['Pincode'])  || 0; } catch(_) { pin   = aAddr['Pincode']  || ''; }
  try { state = parseInt(aAddr['State'])    || 0; } catch(_) { state = aAddr['State']    || ''; }

  fields.tyForm19BF8AddressP3 = {
    country:   91,
    addrLine1: composeAddress(aAddr['FlatDoorBuilding'], aAddr['RoadStreet']),
    addrLine2: composeAddress(aAddr['PremisesBuildingVillage'], aAddr['AreaLocality']),
    pincode:   String(pin),
    postOffice: '',
    locality:  '',
    district:  '',
    state,
  };

  // Derived / fixed
  fields.form19bf8CountryCode1      = 91;
  fields.form19bf8CountryCodeISO    = 'in';
  fields.form19bf8CountryCode       = '+91';
  fields.form19bf8Dealer            = 'Y';
  fields.form19bf8CertSalutation    = 'M/s.';
  fields.form19bf8CerfVerSalutation = 'M/s.';
  fields.form19bf8ShortTerm         = s(itact['AmtIncChrgIt']);
  fields.form19bf8TaxYear           = taxYear();

  return { fields, warnings };
}

// ─────────────────────────────────────────────────────────────────────────────
// IDENTIFY GAPS
// ─────────────────────────────────────────────────────────────────────────────

function identifyGaps(fields) {
  const mandatory = MANDATORY_FIELDS.filter(f => !fields[f.key]);
  const optional  = OPTIONAL_FIELDS.filter(f  => !fields[f.key]);
  return { mandatory, optional };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD FORM 146
// ─────────────────────────────────────────────────────────────────────────────

async function buildForm146(fields, userInputs, hardcodedKeys, firmId) {
  userInputs    = userInputs    || {};
  hardcodedKeys = new Set(hardcodedKeys || []);
  const hardcodedReport = [];

  const form146 = {};

  // 1. Apply XML-extracted fields (skip null values)
  for (const [k, v] of Object.entries(fields)) {
    if (!k.startsWith('_') && v !== null && v !== undefined) {
      form146[k] = v;
    }
  }

  // 2. Overlay master data from Firestore if firmId provided
  if (firmId) {
    try {
      const partnerSnap = await db.collection(COL.partners).where('firmId','==',firmId).limit(1).get();
      if (!partnerSnap.empty) {
        const p = partnerSnap.docs[0].data();
        if (p.caName)       form146.form19bf8NameAcc    = p.caName;
        if (p.memberNumber) form146.form19bf8CAMemberNo = p.memberNumber;
        if (p.firmName)     form146.form19f8Namefirm    = p.firmName;
        if (p.firmRegNo)    form146.form19bf8FirmRegNo  = p.firmRegNo;
      }
    } catch(_) { /* non-fatal */ }
  }

  // 3. Apply user inputs + hardcoded values
  const allFieldDefs = [...MANDATORY_FIELDS, ...OPTIONAL_FIELDS];
  for (const fd of allFieldDefs) {
    if (hardcodedKeys.has(fd.key)) {
      const hval = fd.hardcode || '';
      form146[fd.key] = hval;
      hardcodedReport.push({ key: fd.key, label: fd.label, value: hval });
    } else if (userInputs[fd.key]) {
      form146[fd.key] = userInputs[fd.key];
    }
  }
  // Extra user inputs not in standard lists
  for (const [k, v] of Object.entries(userInputs)) {
    if (v) form146[k] = v;
  }

  // 4. Bank lookup after IFSC known
  const ifsc = form146.form19bf8IFSCcode;
  if (ifsc) {
    try {
      const bankSnap = await db.collection(COL.banks).where('ifsc','==',ifsc).limit(1).get();
      if (!bankSnap.empty) {
        const b = bankSnap.docs[0].data();
        if (b.bankName)   form146.form19bf8NameBank = b.bankName;
        if (b.branchName) form146.form19bf8Branch   = b.branchName;
        if (b.bankName)   form146.form19bf8Subcode1 = b.bankName;
      }
    } catch(_) { /* non-fatal */ }
  }

  // 5. Remittee lookup — populate TIN etc. if in master
  const remiteeName = form146.form19bf8RemiteeName;
  if (remiteeName) {
    try {
      const rmtSnap = await db.collection(COL.remittees)
        .where('name','==',remiteeName).limit(1).get();
      if (!rmtSnap.empty) {
        const rm = rmtSnap.docs[0].data();
        if (rm.tin && !form146.form19bf8RemiteeTIN)   form146.form19bf8RemiteeTIN = rm.tin;
        if (rm.email && !form146.form19bf8RemiteeEmail) form146.form19bf8RemiteeEmail = rm.email;
      }
    } catch(_) { /* non-fatal */ }
  }

  // 6. Panel flags
  for (let i = 0; i < 8; i++) {
    form146[`panel${i}flag`] = true;
    form146[`panel${i}Fl`]   = true;
    form146[`panel${i}Save`] = false;
  }

  form146.startTime = new Date().toString();

  return { form146, hardcodedReport };
}

// ─────────────────────────────────────────────────────────────────────────────
// HARDCODED REPORT TEXT
// ─────────────────────────────────────────────────────────────────────────────

function buildHardcodedReport(items, xmlFilename) {
  const sep = '='.repeat(70);
  const lines = [
    sep,
    'FORM 146 — HARDCODED FIELDS REPORT',
    sep,
    `Source XML   : ${xmlFilename}`,
    `Generated on : ${new Date().toLocaleString('en-IN')}`,
    '',
    'The following fields were NOT filled by the user and were assigned',
    'placeholder/hardcoded values. You MUST update these fields in the',
    'actual Form 146 JSON before importing into the tax system.',
    '',
    '-'.repeat(70),
    `${'FIELD KEY'.padEnd(42)}${'LABEL'.padEnd(36)}HARDCODED VALUE`,
    '-'.repeat(70),
    ...items.map(it => `${it.key.padEnd(42)}${it.label.padEnd(36)}${it.value}`),
    '-'.repeat(70),
    '',
    `Total hardcoded fields : ${items.length}`,
    '',
    'ACTION REQUIRED:',
    '  1. Open the output Form 146 JSON file.',
    '  2. Search for each FIELD KEY listed above.',
    '  3. Replace the placeholder value with the actual correct value.',
    '  4. Verify and import.',
    sep,
  ];
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERIC CRUD HELPER
// ─────────────────────────────────────────────────────────────────────────────

function crudRoutes(collectionName) {
  const r = express.Router();

  // List
  r.get('/', async (req, res) => {
    try {
      const snap = await db.collection(collectionName).orderBy('updatedAt','desc').get();
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      res.json(items);
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Create
  r.post('/', async (req, res) => {
    try {
      const now  = Date.now();
      const data = { ...req.body, createdBy: req.user?.id || '', createdAt: now, updatedAt: now };
      const ref  = await db.collection(collectionName).add(data);
      res.status(201).json({ id: ref.id, ...data });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Update
  r.put('/:id', async (req, res) => {
    try {
      const data = { ...req.body, updatedAt: Date.now(), updatedBy: req.user?.id || '' };
      await db.collection(collectionName).doc(req.params.id).update(data);
      res.json({ id: req.params.id, ...data });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  // Delete
  r.delete('/:id', async (req, res) => {
    try {
      await db.collection(collectionName).doc(req.params.id).delete();
      res.json({ ok: true });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  return r;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/form15cb/parse
 * Body (multipart): xml (file)
 * Returns: { fields, gaps: { mandatory, optional }, warnings }
 */
router.post('/parse', upload.single('xml'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No XML file uploaded' });

    const parsed = parseXml(req.file.buffer);
    const { fields, warnings } = extractFromXml(parsed);
    const gaps = identifyGaps(fields);

    // Fetch remittee history if remittee name found (client-side filter, no composite index)
    let remitteeHistory = [];
    const rName = fields.form19bf8RemiteeName;
    if (rName) {
      try {
        const hSnap = await db.collection(COL.transactions)
          .orderBy('createdAt', 'desc')
          .limit(100)
          .get();
        remitteeHistory = hSnap.docs
          .filter(d => d.data().remiteeName === rName)
          .slice(0, 5)
          .map(d => ({ id: d.id, ...d.data() }));
      } catch(_) { /* not critical */ }
    }

    res.json({ fields, gaps, warnings, remitteeHistory, filename: req.file.originalname });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/form15cb/convert
 * Body (JSON): { fields, userInputs, hardcodedKeys, firmId, xmlFilename }
 * Returns: { form146, hardcodedReport, reportText }
 */
router.post('/convert', async (req, res) => {
  try {
    const { fields, userInputs, hardcodedKeys, firmId, xmlFilename } = req.body;
    if (!fields) return res.status(400).json({ error: 'fields required' });

    const { form146, hardcodedReport } = await buildForm146(
      fields, userInputs || {}, hardcodedKeys || [], firmId
    );

    const reportText = hardcodedReport.length
      ? buildHardcodedReport(hardcodedReport, xmlFilename || 'unknown.xml')
      : '';

    // Save transaction to Firestore
    const txData = {
      xmlFilename:   xmlFilename || '',
      remiterName:   form146.form19bf8RemitterName || '',
      remiteeName:   form146.form19bf8RemiteeName  || '',
      pan:           form146.form19bf8PAN          || '',
      amtForeign:    form146.form19bf8AmtPayableFore || '',
      amtIndian:     form146.form19bf8AmtPayableInd  || '',
      currency:      form146.form19bf8Currency        || '',
      natureRemittance: form146.form19bf8NatureRemittance || '',
      proposedDate:  form146.form19bf8ProposedDate   || '',
      taxYear:       form146.form19bf8TaxYear        || '',
      ifsc:          form146.form19bf8IFSCcode       || '',
      form146,
      hardcodedReport,
      createdBy:     req.user?.id || '',
      createdAt:     Date.now(),
      updatedAt:     Date.now(),
    };

    const txRef = await db.collection(COL.transactions).add(txData);

    res.json({
      transactionId: txRef.id,
      form146,
      hardcodedReport,
      reportText,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Transactions ─────────────────────────────────────────────────────────────

router.get('/transactions', async (req, res) => {
  try {
    // Use simple orderBy (no composite index needed).
    // Client-side filter by remiteeName if provided.
    const limit = Math.min(parseInt(req.query.limit) || 200, 500);
    const snap  = await db.collection(COL.transactions)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    let items = snap.docs.map(d => {
      const { form146, ...meta } = d.data();   // omit full form146 from list view
      return { id: d.id, ...meta };
    });
    // Optional server-side name filter (still no composite index)
    if (req.query.remiteeName) {
      const q = req.query.remiteeName.toLowerCase();
      items = items.filter(t => (t.remiteeName || '').toLowerCase().includes(q));
    }
    res.json(items);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/transactions/:id', async (req, res) => {
  try {
    const doc = await db.collection(COL.transactions).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.delete('/transactions/:id', async (req, res) => {
  try {
    await db.collection(COL.transactions).doc(req.params.id).delete();
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Remittee transaction history (last 5)
router.get('/remittees/:id/history', async (req, res) => {
  try {
    const doc = await db.collection(COL.remittees).doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Remittee not found' });
    const { name } = doc.data();
    // Fetch recent transactions and filter client-side (avoids composite index)
    const snap = await db.collection(COL.transactions)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    const history = snap.docs
      .filter(d => d.data().remiteeName === name)
      .slice(0, 5)
      .map(d => ({ id: d.id, ...d.data() }));
    res.json(history);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Analytics ─────────────────────────────────────────────────────────────────

router.get('/analytics', async (req, res) => {
  try {
    const [txSnap, rmitterSnap, rmitteeSnap, bankSnap, partnerSnap] = await Promise.all([
      db.collection(COL.transactions).orderBy('createdAt','desc').limit(100).get(),
      db.collection(COL.remitters).get(),
      db.collection(COL.remittees).get(),
      db.collection(COL.banks).get(),
      db.collection(COL.partners).get(),
    ]);

    const txs = txSnap.docs.map(d => d.data());

    // Aggregates
    const totalForeignAmt = txs.reduce((sum, t) => sum + (parseFloat(t.amtForeign) || 0), 0);
    const totalIndianAmt  = txs.reduce((sum, t) => sum + (parseFloat(t.amtIndian)  || 0), 0);

    const byCurrency = {};
    const byNature   = {};
    txs.forEach(t => {
      if (t.currency) byCurrency[t.currency] = (byCurrency[t.currency] || 0) + 1;
      if (t.natureRemittance) byNature[t.natureRemittance] = (byNature[t.natureRemittance] || 0) + 1;
    });

    res.json({
      counts: {
        transactions: txSnap.size,
        remitters:    rmitterSnap.size,
        remittees:    rmitteeSnap.size,
        banks:        bankSnap.size,
        partners:     partnerSnap.size,
      },
      totalForeignAmt,
      totalIndianAmt,
      byCurrency,
      byNature,
      recentTransactions: txs.slice(0, 10).map(t => ({
        remiteeName:      t.remiteeName,
        amtForeign:       t.amtForeign,
        currency:         t.currency,
        natureRemittance: t.natureRemittance,
        proposedDate:     t.proposedDate,
        taxYear:          t.taxYear,
        createdAt:        t.createdAt,
      })),
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Masters (generic CRUD) ────────────────────────────────────────────────────

router.use('/remitters', crudRoutes(COL.remitters));
router.use('/remittees', crudRoutes(COL.remittees));
router.use('/banks',     crudRoutes(COL.banks));
router.use('/partners',  crudRoutes(COL.partners));

module.exports = router;
