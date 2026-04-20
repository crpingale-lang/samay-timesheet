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
const form146Template = require('../form146-template.json');
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
  {
    key:'form19bf8IFSCcode',
    label:'Bank IFSC Code',
    description:'Required by Form 146 to identify the remitting bank.',
    example:'ICIC0001234',
    hardcode:'ICIC0000001'
  },
  {
    key:'form19bf8RemiteeTIN',
    label:'Remittee Tax Identification Number',
    description:'Tax ID / TIN of the foreign remittee. Usually sourced from remittee master or supporting tax documents.',
    example:'AB1234567',
    hardcode:'HARDCODED_TIN'
  },
  {
    key:'form19bf8CertPlace',
    label:'CA Certification Place (City)',
    description:'City from which the CA certification is being issued.',
    example:'Mumbai',
    hardcode:'Mumbai'
  },
  {
    key:'form19bf8CertDate',
    label:'CA Certification Date',
    description:'Date printed on the CA certification / filing pack.',
    example: new Date().toISOString().slice(0,10),
    hardcode: new Date().toISOString().slice(0,10)
  },
  {
    key:'form19bf8CertIPAddress',
    label:'System IP Address',
    description:'IP address from which the JSON is being prepared or submitted.',
    example:'203.0.113.10',
    hardcode:'0.0.0.0'
  },
];

const OPTIONAL_FIELDS = [
  {
    key:'form19bf8RemiteeEmail',
    label:'Remittee Email Address',
    description:'Email of the foreign remittee if available in master data or supporting documents.',
    example:'accounts@foreignco.com'
  },
  {
    key:'form19bf8TaxResidNum',
    label:'Tax Residency Certificate Number',
    description:'TRC or residency certificate reference, when DTAA relief is being used.',
    example:'TRC-2025-001'
  },
  {
    key:'form19bf8ArticleReasons',
    label:'DTAA Article Reasons',
    description:'Short justification for the DTAA article selected.',
    example:'Income falls under the cited DTAA article based on the service contract.'
  },
  {
    key:'form19bf8FurnishReasons',
    label:'Furnish Reasons',
    description:'Any explanatory note needed by the offline utility when a supporting detail is unavailable.',
    example:'TRC awaited from remittee; withholding applied conservatively as per contract.'
  },
  {
    key:'form19bf8Basis',
    label:'Basis for Tax Determination',
    description:'Basis on which tax liability is determined.',
    example:'Based on invoices, delivery documents and bank statements'
  },
  {
    key:'form19bf8CertAdd',
    label:'CA Additional Certification Note',
    description:'Optional additional note from the CA for the import record.',
    example:'Values verified with signed certificate and remittance documents.'
  },
];

const HIGH_CONFIDENCE_XML_FIELDS = new Set([
  'form19bf8PAN',
  'form19bf8RemitterName',
  'form19bf8RemiteeName',
  'form19bf8RemiteeName1',
  'form19bf8RemiteeCountry',
  'form19bf8RemittaceCntry',
  'form19bf8AmtPayableFore',
  'form19bf8AmtPayableInd',
  'form19bf8Branch',
  'form19bf8BSRcode',
  'form19bf8ProposedDate',
  'form19bf8GrossedTax',
  'form19bf8Purposecode',
  'form19bf8NatureRemittance',
  'form19bf8RemittanceTax',
  'form19bf8Taxable',
  'form19bf8TaxableInc',
  'form19bf8TaxLiability',
  'form19bf8Taxdetermine',
  'form19bf8ReliefClaimed',
  'form19bf8TaxResidency',
  'form19bf8Relevant',
  'form19bf8Article',
  'form19bf8TaxbleIncome',
  'form19bf8TaxbleLiablity',
  'form19bf8Ratededctax',
  'form19bf8RemitanceAcc',
  'form19bf8TaxableIncDTAA',
  'form19bf8CaptialGains',
  'form19bf8NaturePayment',
  'form19bf8RemittanceDrp',
  'form19bf8TDSforeign',
  'form19bf8TDSIndian',
  'form19bf8RateTDS',
  'form19bf8DateAmtTDS',
  'form19bf8AmtPayableFore1',
  'form19bf8NameAcc',
  'form19bf8CAMemberNo',
  'form19f8Namefirm',
  'form19bf8FirmRegNo',
  'form19bf8CountryCode1',
  'form19bf8CountryCodeISO',
  'form19bf8CountryCode',
  'form19bf8Dealer',
  'form19bf8CertSalutation',
  'form19bf8CerfVerSalutation',
  'form19bf8TaxYear'
]);

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

function hasMeaningfulValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function firstMeaningfulValue(...values) {
  for (const value of values) {
    if (hasMeaningfulValue(value)) return value;
  }
  return '';
}

function normalizeLookupText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeClientIp(ip) {
  const raw = String(ip || '').trim();
  if (!raw) return '';
  if (raw === '::1') return '127.0.0.1';
  return raw.replace(/^::ffff:/, '');
}

function nowISTString() {
  return new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function taxYear() {
  const now = new Date();
  const fy = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${fy}-${String(fy + 1).slice(-2)}`;
}

async function findFirestoreRecord(collectionName, field, value) {
  if (!hasMeaningfulValue(value)) return null;
  try {
    const snap = await db.collection(collectionName).where(field, '==', value).limit(1).get();
    if (snap.empty) return null;
    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch {
    return null;
  }
}

async function loadLookupContext(fields, preferredPartnerId = '') {
  const partnerByIdPromise = preferredPartnerId
    ? db.collection(COL.partners).doc(preferredPartnerId).get()
        .then(doc => (doc.exists ? { id: doc.id, ...doc.data() } : null))
        .catch(() => null)
    : Promise.resolve(null);

  const [
    bankByBsr,
    bankByBranch,
    remitteeByName,
    remitterByPan,
    remitterByName,
    partnerByMember,
    partnerByName,
    partnerById
  ] = await Promise.all([
    findFirestoreRecord(COL.banks, 'bsrCode', fields.form19bf8BSRcode),
    findFirestoreRecord(COL.banks, 'branchName', fields.form19bf8Branch),
    findFirestoreRecord(COL.remittees, 'name', fields.form19bf8RemiteeName),
    findFirestoreRecord(COL.remitters, 'pan', fields.form19bf8PAN),
    findFirestoreRecord(COL.remitters, 'name', fields.form19bf8RemitterName),
    findFirestoreRecord(COL.partners, 'memberNumber', fields.form19bf8CAMemberNo),
    findFirestoreRecord(COL.partners, 'caName', fields.form19bf8NameAcc),
    partnerByIdPromise
  ]);

  return {
    bank: bankByBsr || bankByBranch || null,
    remittee: remitteeByName || null,
    remitter: remitterByPan || remitterByName || null,
    partner: partnerById || partnerByMember || partnerByName || null,
  };
}

function buildSuggestionMap(fields, lookupContext, requestIp = '') {
  const bank = lookupContext?.bank || null;
  const remittee = lookupContext?.remittee || null;
  const today = new Date().toISOString().slice(0,10);

  return {
    form19bf8IFSCcode: firstMeaningfulValue(bank?.ifsc),
    form19bf8RemiteeTIN: firstMeaningfulValue(remittee?.tin),
    form19bf8CertPlace: firstMeaningfulValue(fields.form19bf8CertPlace),
    form19bf8CertDate: today,
    form19bf8CertIPAddress: normalizeClientIp(requestIp),
    form19bf8RemiteeEmail: firstMeaningfulValue(remittee?.email),
    form19bf8TaxResidNum: '',
    form19bf8ArticleReasons: hasMeaningfulValue(fields.form19bf8Article)
      ? `Refer DTAA article ${fields.form19bf8Article} for the withholding position.`
      : '',
    form19bf8FurnishReasons: fields.form19bf8TaxResidency === 'N'
      ? 'Provide the reason if TRC or other supporting tax residency evidence is not available.'
      : '',
    form19bf8Basis: firstMeaningfulValue(fields.form19bf8Basis, fields.form19bf8Taxdetermine),
    form19bf8CertAdd: firstMeaningfulValue(fields.form19bf8Basis, fields.form19bf8Taxdetermine),
  };
}

function identifyGaps(fields, lookupContext = {}, requestIp = '') {
  const suggestions = buildSuggestionMap(fields, lookupContext, requestIp);
  const enrich = field => {
    const suggestedValue = firstMeaningfulValue(suggestions[field.key]);
    const suggestionSourceMap = {
      form19bf8IFSCcode: lookupContext?.bank ? 'bank master' : '',
      form19bf8RemiteeTIN: lookupContext?.remittee ? 'remittee master' : '',
      form19bf8CertPlace: hasMeaningfulValue(fields.form19bf8CertPlace) ? 'accountant address in XML' : '',
      form19bf8CertDate: 'current date',
      form19bf8CertIPAddress: hasMeaningfulValue(requestIp) ? 'current request IP' : '',
      form19bf8RemiteeEmail: lookupContext?.remittee ? 'remittee master' : '',
      form19bf8ArticleReasons: hasMeaningfulValue(fields.form19bf8Article) ? 'DTAA article in XML' : '',
      form19bf8FurnishReasons: fields.form19bf8TaxResidency === 'N' ? 'DTAA residency flag in XML' : '',
      form19bf8Basis: hasMeaningfulValue(fields.form19bf8Basis) ? 'basis for tax determination in XML' : '',
      form19bf8CertAdd: hasMeaningfulValue(fields.form19bf8Basis) ? 'basis for tax determination in XML' : '',
    };

    return {
      ...field,
      suggestedValue,
      suggestedBy: suggestionSourceMap[field.key] || '',
      fallbackValue: hasMeaningfulValue(form146Template[field.key]) ? form146Template[field.key] : '',
    };
  };

  return {
    mandatory: MANDATORY_FIELDS
      .filter(field => !HIGH_CONFIDENCE_XML_FIELDS.has(field.key) || !hasMeaningfulValue(fields[field.key]))
      .map(enrich),
    optional: OPTIONAL_FIELDS
      .filter(field => !HIGH_CONFIDENCE_XML_FIELDS.has(field.key) || !hasMeaningfulValue(fields[field.key]))
      .map(enrich),
  };
}

function summarizeLookupMatches(lookupContext = {}) {
  const labelFor = {
    bank: match => firstMeaningfulValue(match.bankName, match.branchName, match.ifsc),
    remittee: match => firstMeaningfulValue(match.name, match.email),
    remitter: match => firstMeaningfulValue(match.name, match.pan),
    partner: match => firstMeaningfulValue(match.caName, match.firmName, match.memberNumber),
  };

  return Object.fromEntries(
    Object.entries(lookupContext)
      .filter(([, value]) => value && value.id)
      .map(([key, value]) => [key, { id: value.id, label: labelFor[key](value) }])
  );
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

function stripXmlPrefixes(node) {
  if (Array.isArray(node)) {
    return node.map(stripXmlPrefixes);
  }
  if (!node || typeof node !== 'object') {
    return node;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(node)) {
    const nextKey = key.startsWith('@_') ? key : key.split(':').pop();
    normalized[nextKey] = stripXmlPrefixes(value);
  }
  return normalized;
}

function parseXml(buffer) {
  const xmlStr = buffer.toString('utf8');
  return stripXmlPrefixes(xmlParser.parse(xmlStr));
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
  fields.form19bf8PAN   = s(remitter['PAN']);
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
  fields.form19bf8Basis         = s(itact['BasisDeterTax']);

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
    postOffice: s(aAddr['TownCityDistrict']),
    locality:  s(aAddr['AreaLocality']),
    district:  s(aAddr['TownCityDistrict']),
    state,
  };

  // Derived / fixed
  fields.form19bf8CountryCode1      = 91;
  fields.form19bf8CountryCodeISO    = 'in';
  fields.form19bf8CountryCode       = '+91';
  fields.form19bf8Dealer            = 'Y';
  fields.form19bf8CertSalutation    = 'M/s.';
  fields.form19bf8CerfVerSalutation = 'M/s.';
  fields.form19bf8CertPlace         = s(aAddr['TownCityDistrict']);
  fields.form19bf8ShortTerm         = s(itact['AmtIncChrgIt']);
  fields.form19bf8TaxYear           = taxYear();

  return { fields, warnings };
}

function splitNameParts(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: '', midName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], midName: '', lastName: '' };
  if (parts.length === 2) return { firstName: parts[0], midName: '', lastName: parts[1] };
  return {
    firstName: parts[0],
    midName: parts.slice(1, -1).join(' '),
    lastName: parts[parts.length - 1]
  };
}

function applyRemitterMaster(form146, remitter = {}) {
  if (!remitter) return;

  const remitterName = firstMeaningfulValue(remitter.name, form146.form19bf8RemitterName);
  const pan = firstMeaningfulValue(remitter.pan, form146.form19bf8PAN);
  const status = firstMeaningfulValue(remitter.status, form146.form19bf8Status, 'Company');
  const address = firstMeaningfulValue(
    remitter.form19bf8Address,
    composeAddress(remitter.addr1, remitter.addr2, remitter.city, remitter.postOffice, remitter.district, remitter.state, remitter.pin)
  );

  form146.entityNumber = firstMeaningfulValue(form146.entityNumber, remitter.entityNumber, pan);
  form146.entityFirstName = firstMeaningfulValue(form146.entityFirstName, remitter.entityFirstName);
  form146.entityMidName = firstMeaningfulValue(form146.entityMidName, remitter.entityMidName);
  form146.entityLastName = firstMeaningfulValue(form146.entityLastName, remitter.entityLastName);
  form146.entityAddrLine1Txt = firstMeaningfulValue(form146.entityAddrLine1Txt, remitter.entityAddrLine1Txt, remitter.addr1);
  form146.entityAddrLine2Txt = firstMeaningfulValue(form146.entityAddrLine2Txt, remitter.entityAddrLine2Txt, remitter.addr2);
  form146.entityPinCd = firstMeaningfulValue(form146.entityPinCd, remitter.entityPinCd, remitter.pin);
  form146.entityLocalityDesc = firstMeaningfulValue(form146.entityLocalityDesc, remitter.entityLocalityDesc, remitter.city);
  form146.entityStateCd = firstMeaningfulValue(form146.entityStateCd, remitter.entityStateCd);
  form146.entityStateDesc = firstMeaningfulValue(form146.entityStateDesc, remitter.entityStateDesc, remitter.state);
  form146.entityCountryCd = firstMeaningfulValue(form146.entityCountryCd, remitter.entityCountryCd, 91);
  form146.entityCountryName = firstMeaningfulValue(form146.entityCountryName, remitter.entityCountryName, 'INDIA');
  form146.entityDistrictDesc = firstMeaningfulValue(form146.entityDistrictDesc, remitter.entityDistrictDesc, remitter.district);
  form146.entityPostofficeDesc = firstMeaningfulValue(form146.entityPostofficeDesc, remitter.entityPostofficeDesc, remitter.postOffice);
  form146.entityTaxPayerCatgCd = firstMeaningfulValue(form146.entityTaxPayerCatgCd, remitter.entityTaxPayerCatgCd);
  form146.entityTaxPayerCatgDesc = firstMeaningfulValue(form146.entityTaxPayerCatgDesc, remitter.entityTaxPayerCatgDesc, status);
  form146.entityPrimaryEmail = firstMeaningfulValue(form146.entityPrimaryEmail, remitter.entityPrimaryEmail, remitter.email);
  form146.entitySecondaryEmail = firstMeaningfulValue(form146.entitySecondaryEmail, remitter.entitySecondaryEmail);
  form146.entityPrimaryMobile = firstMeaningfulValue(form146.entityPrimaryMobile, remitter.entityPrimaryMobile, remitter.mobile);
  form146.entityDesig = firstMeaningfulValue(form146.entityDesig, remitter.entityDesig, status);
  form146.pcPan = firstMeaningfulValue(form146.pcPan, remitter.pcPan);

  form146.form19bf8RemitterName = remitterName;
  form146.form19bf8PAN = pan;
  form146.form19bf8Status = status;
  form146.form19bf8ResStatus = firstMeaningfulValue(form146.form19bf8ResStatus, 'RES');
  form146.form19bf8Email = firstMeaningfulValue(form146.form19bf8Email, remitter.email);
  form146.form19bf8MobileNumber = firstMeaningfulValue(form146.form19bf8MobileNumber, remitter.mobile);
  form146.form19bf8Address = firstMeaningfulValue(form146.form19bf8Address, address);
}

function applyPartnerMaster(form146, partner = {}) {
  if (!partner) return;

  const nameParts = splitNameParts(partner.caName);
  form146.userId = firstMeaningfulValue(form146.userId, partner.userId, partner.memberNumber ? `ARCA${partner.memberNumber}` : '');
  form146.userFirstName = firstMeaningfulValue(form146.userFirstName, partner.userFirstName, nameParts.firstName);
  form146.userMidName = firstMeaningfulValue(form146.userMidName, partner.userMidName, nameParts.midName);
  form146.userLastName = firstMeaningfulValue(form146.userLastName, partner.userLastName, nameParts.lastName);
  form146.userRoleCd = firstMeaningfulValue(form146.userRoleCd, partner.userRoleCd, 'CA');
  form146.userPan = firstMeaningfulValue(form146.userPan, partner.userPan, partner.pan);
  form146.userEmail = firstMeaningfulValue(form146.userEmail, partner.userEmail, partner.email);
  form146.userMobile = firstMeaningfulValue(form146.userMobile, partner.userMobile, partner.mobile);

  form146.form19bf8NameAcc = firstMeaningfulValue(form146.form19bf8NameAcc, partner.form19bf8NameAcc, partner.caName);
  form146.form19bf8CAMemberNo = firstMeaningfulValue(form146.form19bf8CAMemberNo, partner.form19bf8CAMemberNo, partner.memberNumber);
  form146.form19f8Namefirm = firstMeaningfulValue(form146.form19f8Namefirm, partner.form19f8Namefirm, partner.firmName);
  form146.form19bf8FirmRegNo = firstMeaningfulValue(form146.form19bf8FirmRegNo, partner.form19bf8FirmRegNo, partner.firmRegNo);
}

function applyDerivedIdentityFallbacks(form146) {
  const accountantNameParts = splitNameParts(form146.form19bf8NameAcc);

  form146.entityNumber = firstMeaningfulValue(form146.entityNumber, form146.form19bf8PAN);
  form146.entityPrimaryEmail = firstMeaningfulValue(form146.entityPrimaryEmail, form146.form19bf8Email);
  form146.entityPrimaryMobile = firstMeaningfulValue(form146.entityPrimaryMobile, form146.form19bf8MobileNumber);

  form146.userId = firstMeaningfulValue(
    form146.userId,
    hasMeaningfulValue(form146.form19bf8CAMemberNo) ? `ARCA${form146.form19bf8CAMemberNo}` : ''
  );
  form146.userFirstName = firstMeaningfulValue(form146.userFirstName, accountantNameParts.firstName);
  form146.userMidName = firstMeaningfulValue(form146.userMidName, accountantNameParts.midName);
  form146.userLastName = firstMeaningfulValue(form146.userLastName, accountantNameParts.lastName);
  form146.userRoleCd = firstMeaningfulValue(form146.userRoleCd, 'CA');
}

function buildMappingAudit(form146, fields = {}, userInputs = {}) {
  const audit = {};

  for (const [key, jsonValue] of Object.entries(form146)) {
    const xmlValue = fields[key];
    const userValue = userInputs[key];
    const fallbackValue = form146Template[key];
    const jsonSerialized = JSON.stringify(jsonValue);
    const xmlSerialized = JSON.stringify(xmlValue);
    const userSerialized = JSON.stringify(userValue);
    const fallbackSerialized = JSON.stringify(fallbackValue);

    let source = 'master_or_derived';
    if (hasMeaningfulValue(userValue) && userSerialized === jsonSerialized) {
      source = 'user';
    } else if (HIGH_CONFIDENCE_XML_FIELDS.has(key) && hasMeaningfulValue(xmlValue) && xmlSerialized === jsonSerialized) {
      source = 'xml';
    } else if (hasMeaningfulValue(fallbackValue) && fallbackSerialized === jsonSerialized) {
      source = 'template';
    } else if (!hasMeaningfulValue(jsonValue)) {
      source = 'blank';
    } else if (hasMeaningfulValue(xmlValue)) {
      source = 'xml_review';
    }

    audit[key] = {
      key,
      source,
      xmlValue: hasMeaningfulValue(xmlValue) ? xmlValue : '',
      jsonValue,
      fallbackValue: hasMeaningfulValue(fallbackValue) ? fallbackValue : '',
      editable: (
        !key.startsWith('panel')
        && key !== 'startTime'
        && key !== 'formVersion'
        && key !== 'schemaVersion'
        && key !== 'citId'
        && typeof jsonValue !== 'object'
      ),
    };
  }

  return audit;
}

function validateMandatoryFields(form146) {
  return MANDATORY_FIELDS.filter(field => !hasMeaningfulValue(form146[field.key]));
}

// ─────────────────────────────────────────────────────────────────────────────
// IDENTIFY GAPS
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// BUILD FORM 146
// ─────────────────────────────────────────────────────────────────────────────

async function buildForm146(fields, userInputs, hardcodedKeys, firmId) {
  userInputs    = userInputs    || {};
  hardcodedKeys = new Set(hardcodedKeys || []);
  const hardcodedReport = [];

  const form146 = JSON.parse(JSON.stringify(form146Template));
  const lookupContext = await loadLookupContext(fields, firmId);
  const suggestionMap = buildSuggestionMap(fields, lookupContext);

  applyRemitterMaster(form146, lookupContext.remitter);
  applyPartnerMaster(form146, lookupContext.partner);

  // 1. Apply XML-extracted fields on top of the base template/master values.
  for (const [k, v] of Object.entries(fields)) {
    if (
      !k.startsWith('_')
      && HIGH_CONFIDENCE_XML_FIELDS.has(k)
      && v !== null
      && v !== undefined
      && hasMeaningfulValue(v)
    ) {
      form146[k] = v;
    }
  }
  applyDerivedIdentityFallbacks(form146);

  // 2. Apply user inputs + hardcoded values
  const allFieldDefs = [...MANDATORY_FIELDS, ...OPTIONAL_FIELDS];
  for (const fd of allFieldDefs) {
    if (hardcodedKeys.has(fd.key)) {
      const hval = firstMeaningfulValue(fd.hardcode, suggestionMap[fd.key], '');
      form146[fd.key] = hval;
      hardcodedReport.push({ key: fd.key, label: fd.label, value: hval });
    } else if (hasMeaningfulValue(userInputs[fd.key])) {
      form146[fd.key] = userInputs[fd.key];
    }
  }

  // Extra user inputs not in the prompt field lists.
  for (const [k, v] of Object.entries(userInputs)) {
    if (hasMeaningfulValue(v)) form146[k] = v;
  }

  const bankRecord = lookupContext.bank
    || await findFirestoreRecord(COL.banks, 'ifsc', form146.form19bf8IFSCcode);
  if (bankRecord) {
    if (bankRecord.ifsc) {
      form146.form19bf8IFSCcode = firstMeaningfulValue(form146.form19bf8IFSCcode, bankRecord.ifsc);
    }
    if (bankRecord.bankName) {
      form146.form19bf8NameBank = firstMeaningfulValue(form146.form19bf8NameBank, bankRecord.bankName);
      form146.form19bf8Subcode1 = firstMeaningfulValue(form146.form19bf8Subcode1, bankRecord.bankName);
    }
    if (bankRecord.branchName) {
      form146.form19bf8Branch = firstMeaningfulValue(form146.form19bf8Branch, bankRecord.branchName);
    }
  }

  if (lookupContext.remittee) {
    if (lookupContext.remittee.tin) {
      form146.form19bf8RemiteeTIN = firstMeaningfulValue(form146.form19bf8RemiteeTIN, lookupContext.remittee.tin);
    }
    if (lookupContext.remittee.email) {
      form146.form19bf8RemiteeEmail = firstMeaningfulValue(form146.form19bf8RemiteeEmail, lookupContext.remittee.email);
    }
  }

  // 3. Panel flags expected by the reference utility/import shape.
  for (let i = 1; i <= 7; i++) {
    form146[`panel${i}flag`] = true;
    form146[`panel${i}Fl`]   = true;
    form146[`panel${i}Save`] = false;
  }

  form146.startTime = new Date().toString();

  const missingMandatory = validateMandatoryFields(form146);
  if (missingMandatory.length) {
    const labels = missingMandatory.map(field => field.label).join(', ');
    const error = new Error(`Missing required Form 146 fields: ${labels}`);
    error.statusCode = 400;
    throw error;
  }

  return { form146, hardcodedReport, mappingAudit: buildMappingAudit(form146, fields, userInputs) };
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
    const lookupContext = await loadLookupContext(fields);
    const gaps = identifyGaps(fields, lookupContext, req.ip);
    const lookupMatches = summarizeLookupMatches(lookupContext);

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

    res.json({ fields, gaps, warnings, remitteeHistory, lookupMatches, filename: req.file.originalname });
  } catch(e) {
    res.status(e.statusCode || 500).json({ error: e.message });
  }
});

/**
 * POST /api/form15cb/preview
 * Body (JSON): { fields, userInputs, hardcodedKeys, firmId }
 * Returns: { form146, mappingAudit }
 */
router.post('/preview', async (req, res) => {
  try {
    const { fields, userInputs, hardcodedKeys, firmId } = req.body;
    if (!fields) return res.status(400).json({ error: 'fields required' });

    const { form146, mappingAudit } = await buildForm146(
      fields, userInputs || {}, hardcodedKeys || [], firmId
    );

    res.json({ form146, mappingAudit });
  } catch(e) {
    res.status(e.statusCode || 500).json({ error: e.message });
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

    const { form146, hardcodedReport, mappingAudit } = await buildForm146(
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
      mappingAudit,
      hardcodedReport,
      createdBy:     req.user?.id || '',
      createdAt:     Date.now(),
      updatedAt:     Date.now(),
    };

    const txRef = await db.collection(COL.transactions).add(txData);

    res.json({
      transactionId: txRef.id,
      form146,
      mappingAudit,
      hardcodedReport,
      reportText,
    });
  } catch(e) {
    res.status(e.statusCode || 500).json({ error: e.message });
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
