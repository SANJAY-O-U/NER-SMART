/**
 * NER Geography Configuration
 * ----------------------------
 * Central, single-source definition of the 8 Northeast India states and
 * their districts, keyed by LGD (Local Government Directory) code where
 * a code was actually obtained.
 *
 * SOURCE: "Latest district list exported from lgdirectory.gov.in"
 * (github.com/planemad/cd6b523725c4d8d46712639302edf6e4), cross-checked
 * against LGD district codes observed live in real SACHET CAP alerts
 * during Phase 3A (e.g. Dimapur=244, Kohima=245, Phek=248, Peren=613 —
 * all match this table).
 *
 * KNOWN LIMITATIONS (do not silently work around these):
 * 1. This export is dated ~2020. Districts created after that date are
 *    MISSING. Confirmed during Phase 3A: a live alert referenced
 *    "Chumoukedima" (Nagaland) with LGD code 764, which does NOT appear
 *    in this table (Chumoukedima was carved out of Kohima district in
 *    2021). Alerts naming such districts fall back to areaDesc text
 *    matching (see sachetValidation.js), not LGD code matching.
 * 2. Tripura's numeric LGD district codes were NOT found in the sources
 *    consulted — only district names. Tripura districts are listed here
 *    with `lgdCode: null` and matched by name only. Do not invent codes.
 */

const NER_STATES = [
  'ASSAM',
  'ARUNACHAL PRADESH',
  'MANIPUR',
  'MEGHALAYA',
  'MIZORAM',
  'NAGALAND',
  'TRIPURA',
  'SIKKIM',
];

// LGD District Code -> { name, state }. Verified against the source
// above; cross-checked live against Phase 3A SACHET data where possible.
const LGD_DISTRICTS = {
  // Arunachal Pradesh (state LGD code 12)
  628: { name: 'ANJAW', state: 'ARUNACHAL PRADESH' },
  229: { name: 'CHANGLANG', state: 'ARUNACHAL PRADESH' },
  230: { name: 'DIBANG VALLEY', state: 'ARUNACHAL PRADESH' },
  231: { name: 'EAST KAMENG', state: 'ARUNACHAL PRADESH' },
  232: { name: 'EAST SIANG', state: 'ARUNACHAL PRADESH' },
  718: { name: 'KAMLE', state: 'ARUNACHAL PRADESH' },
  677: { name: 'KRA DAADI', state: 'ARUNACHAL PRADESH' },
  233: { name: 'KURUNG KUMEY', state: 'ARUNACHAL PRADESH' },
  724: { name: 'LEPARADA', state: 'ARUNACHAL PRADESH' },
  234: { name: 'LOHIT', state: 'ARUNACHAL PRADESH' },
  666: { name: 'LONGDING', state: 'ARUNACHAL PRADESH' },
  235: { name: 'LOWER DIBANG VALLEY', state: 'ARUNACHAL PRADESH' },
  719: { name: 'LOWER SIANG', state: 'ARUNACHAL PRADESH' },
  236: { name: 'LOWER SUBANSIRI', state: 'ARUNACHAL PRADESH' },
  678: { name: 'NAMSAI', state: 'ARUNACHAL PRADESH' },
  723: { name: 'PAKKE KESSANG', state: 'ARUNACHAL PRADESH' },
  237: { name: 'PAPUM PARE', state: 'ARUNACHAL PRADESH' },
  725: { name: 'SHI YOMI', state: 'ARUNACHAL PRADESH' },
  679: { name: 'SIANG', state: 'ARUNACHAL PRADESH' },
  238: { name: 'TAWANG', state: 'ARUNACHAL PRADESH' },
  239: { name: 'TIRAP', state: 'ARUNACHAL PRADESH' },
  240: { name: 'UPPER SIANG', state: 'ARUNACHAL PRADESH' },
  241: { name: 'UPPER SUBANSIRI', state: 'ARUNACHAL PRADESH' },
  242: { name: 'WEST KAMENG', state: 'ARUNACHAL PRADESH' },
  243: { name: 'WEST SIANG', state: 'ARUNACHAL PRADESH' },

  // Assam (state LGD code 18)
  616: { name: 'BAKSA', state: 'ASSAM' },
  280: { name: 'BARPETA', state: 'ASSAM' },
  705: { name: 'BISWANATH', state: 'ASSAM' },
  281: { name: 'BONGAIGAON', state: 'ASSAM' },
  282: { name: 'CACHAR', state: 'ASSAM' },
  708: { name: 'CHARAIDEO', state: 'ASSAM' },
  612: { name: 'CHIRANG', state: 'ASSAM' },
  283: { name: 'DARRANG', state: 'ASSAM' },
  284: { name: 'DHEMAJI', state: 'ASSAM' },
  285: { name: 'DHUBRI', state: 'ASSAM' },
  286: { name: 'DIBRUGARH', state: 'ASSAM' },
  299: { name: 'DIMA HASAO', state: 'ASSAM' },
  287: { name: 'GOALPARA', state: 'ASSAM' },
  288: { name: 'GOLAGHAT', state: 'ASSAM' },
  289: { name: 'HAILAKANDI', state: 'ASSAM' },
  709: { name: 'HOJAI', state: 'ASSAM' },
  290: { name: 'JORHAT', state: 'ASSAM' },
  291: { name: 'KAMRUP', state: 'ASSAM' },
  618: { name: 'KAMRUP METRO', state: 'ASSAM' },
  292: { name: 'KARBI ANGLONG', state: 'ASSAM' },
  293: { name: 'KARIMGANJ', state: 'ASSAM' },
  294: { name: 'KOKRAJHAR', state: 'ASSAM' },
  295: { name: 'LAKHIMPUR', state: 'ASSAM' },
  706: { name: 'MAJULI', state: 'ASSAM' },
  296: { name: 'MARIGAON', state: 'ASSAM' },
  297: { name: 'NAGAON', state: 'ASSAM' },
  298: { name: 'NALBARI', state: 'ASSAM' },
  300: { name: 'SIVASAGAR', state: 'ASSAM' },
  301: { name: 'SONITPUR', state: 'ASSAM' },
  707: { name: 'SOUTH SALMARA MANCACHAR', state: 'ASSAM' },
  302: { name: 'TINSUKIA', state: 'ASSAM' },
  617: { name: 'UDALGURI', state: 'ASSAM' },
  710: { name: 'WEST KARBI ANGLONG', state: 'ASSAM' },

  // Manipur (state LGD code 14)
  252: { name: 'BISHNUPUR', state: 'MANIPUR' },
  253: { name: 'CHANDEL', state: 'MANIPUR' },
  254: { name: 'CHURACHANDPUR', state: 'MANIPUR' },
  255: { name: 'IMPHAL EAST', state: 'MANIPUR' },
  256: { name: 'IMPHAL WEST', state: 'MANIPUR' },
  713: { name: 'JIRIBAM', state: 'MANIPUR' },
  711: { name: 'KAKCHING', state: 'MANIPUR' },
  717: { name: 'KAMJONG', state: 'MANIPUR' },
  712: { name: 'KANGPOKPI', state: 'MANIPUR' },
  714: { name: 'NONEY', state: 'MANIPUR' },
  715: { name: 'PHERZAWL', state: 'MANIPUR' },
  257: { name: 'SENAPATI', state: 'MANIPUR' },
  258: { name: 'TAMENGLONG', state: 'MANIPUR' },
  716: { name: 'TENGNOUPAL', state: 'MANIPUR' },
  259: { name: 'THOUBAL', state: 'MANIPUR' },
  260: { name: 'UKHRUL', state: 'MANIPUR' },

  // Meghalaya (state LGD code 17)
  273: { name: 'EAST GARO HILLS', state: 'MEGHALAYA' },
  657: { name: 'EAST JAINTIA HILLS', state: 'MEGHALAYA' },
  274: { name: 'EAST KHASI HILLS', state: 'MEGHALAYA' },
  656: { name: 'NORTH GARO HILLS', state: 'MEGHALAYA' },
  276: { name: 'RI BHOI', state: 'MEGHALAYA' },
  277: { name: 'SOUTH GARO HILLS', state: 'MEGHALAYA' },
  663: { name: 'SOUTH WEST GARO HILLS', state: 'MEGHALAYA' },
  658: { name: 'SOUTH WEST KHASI HILLS', state: 'MEGHALAYA' },
  278: { name: 'WEST GARO HILLS', state: 'MEGHALAYA' },
  275: { name: 'WEST JAINTIA HILLS', state: 'MEGHALAYA' },
  279: { name: 'WEST KHASI HILLS', state: 'MEGHALAYA' },

  // Mizoram (state LGD code 15)
  261: { name: 'AIZAWL', state: 'MIZORAM' },
  262: { name: 'CHAMPHAI', state: 'MIZORAM' },
  726: { name: 'HNAHTHIAL', state: 'MIZORAM' },
  728: { name: 'KHAWZAWL', state: 'MIZORAM' },
  263: { name: 'KOLASIB', state: 'MIZORAM' },
  264: { name: 'LAWNGTLAI', state: 'MIZORAM' },
  265: { name: 'LUNGLEI', state: 'MIZORAM' },
  266: { name: 'MAMIT', state: 'MIZORAM' },
  267: { name: 'SAIHA', state: 'MIZORAM' },
  727: { name: 'SAITUAL', state: 'MIZORAM' },
  268: { name: 'SERCHHIP', state: 'MIZORAM' },

  // Nagaland (state LGD code 13)
  244: { name: 'DIMAPUR', state: 'NAGALAND' },
  614: { name: 'KIPHIRE', state: 'NAGALAND' },
  245: { name: 'KOHIMA', state: 'NAGALAND' },
  615: { name: 'LONGLENG', state: 'NAGALAND' },
  246: { name: 'MOKOKCHUNG', state: 'NAGALAND' },
  247: { name: 'MON', state: 'NAGALAND' },
  613: { name: 'PEREN', state: 'NAGALAND' },
  248: { name: 'PHEK', state: 'NAGALAND' },
  249: { name: 'TUENSANG', state: 'NAGALAND' },
  250: { name: 'WOKHA', state: 'NAGALAND' },
  251: { name: 'ZUNHEBOTO', state: 'NAGALAND' },
  // NOTE: "Chumoukedima" (LGD 764, split from Kohima in 2021) and any
  // other post-2020 district is intentionally absent — see file header.

  // Sikkim (state LGD code 11)
  225: { name: 'EAST DISTRICT', state: 'SIKKIM' },
  226: { name: 'NORTH DISTRICT', state: 'SIKKIM' },
  227: { name: 'SOUTH DISTRICT', state: 'SIKKIM' },
  228: { name: 'WEST DISTRICT', state: 'SIKKIM' },
};

// Tripura: names only. No numeric LGD code was found in the sources
// consulted during Phase 3B — matched by areaDesc text only. Do not
// invent codes for these.
const TRIPURA_DISTRICTS_NAME_ONLY = [
  'DHALAI',
  'GOMATI',
  'KHOWAI',
  'NORTH TRIPURA',
  'SEPAHIJALA',
  'SOUTH TRIPURA',
  'UNAKOTI',
  'WEST TRIPURA',
];

/**
 * Approximate district HQ coordinates, for the districts our current
 * imported road corridor (Guwahati-Imphal, see DATA_PROVENANCE.md)
 * actually passes through. Used ONLY as a fallback to approximate which
 * district a road segment belongs to, since Phase 1's road import does
 * not carry a real district attribute (no district boundary join was
 * done — see DATA_PROVENANCE.md limitations).
 *
 * This is a NEAREST-HQ APPROXIMATION, not a polygon boundary join.
 * Coordinates are real, well-known town locations (district
 * headquarters), not fabricated — but "nearest HQ" is not the same as
 * "actually inside that district's boundary". Roads near a district
 * border may be mis-assigned. Labelled `NEAREST_DISTRICT_HQ_APPROXIMATION`
 * everywhere this is used; replace with a real district-boundary
 * point-in-polygon join in a future phase for precision.
 */
const NER_DISTRICT_HQ_APPROX = [
  { district: 'KAMRUP METRO', state: 'ASSAM', lat: 26.1445, lng: 91.7362, lgdCode: 618 }, // Guwahati
  { district: 'KAMRUP', state: 'ASSAM', lat: 26.1157, lng: 91.5, lgdCode: 291 },
  { district: 'NAGAON', state: 'ASSAM', lat: 26.348, lng: 92.684, lgdCode: 297 },
  { district: 'KARBI ANGLONG', state: 'ASSAM', lat: 25.8449, lng: 93.4292, lgdCode: 292 }, // Diphu
  { district: 'DIMA HASAO', state: 'ASSAM', lat: 25.1667, lng: 93.0167, lgdCode: 299 }, // Haflong
  { district: 'DIMAPUR', state: 'NAGALAND', lat: 25.9091, lng: 93.7266, lgdCode: 244 },
  { district: 'KOHIMA', state: 'NAGALAND', lat: 25.6751, lng: 94.1086, lgdCode: 245 },
  { district: 'PEREN', state: 'NAGALAND', lat: 25.5167, lng: 93.75, lgdCode: 613 },
  { district: 'SENAPATI', state: 'MANIPUR', lat: 25.2667, lng: 94.0167, lgdCode: 257 },
  { district: 'IMPHAL WEST', state: 'MANIPUR', lat: 24.817, lng: 93.9368, lgdCode: 256 },
  { district: 'IMPHAL EAST', state: 'MANIPUR', lat: 24.817, lng: 93.95, lgdCode: 255 },
];

function lookupDistrictByLgdCode(code) {
  return LGD_DISTRICTS[Number(code)] || null;
}

/** Case-insensitive substring match of a district name within free text (areaDesc/title). */
function findDistrictNamesInText(text) {
  if (!text) return [];
  const upper = text.toUpperCase();
  const found = [];
  for (const [code, d] of Object.entries(LGD_DISTRICTS)) {
    if (upper.includes(d.name)) found.push({ name: d.name, state: d.state, lgdCode: Number(code) });
  }
  for (const name of TRIPURA_DISTRICTS_NAME_ONLY) {
    if (upper.includes(name)) found.push({ name, state: 'TRIPURA', lgdCode: null });
  }
  return found;
}

function isNerState(stateName) {
  if (!stateName) return false;
  return NER_STATES.includes(stateName.toUpperCase());
}

module.exports = {
  NER_STATES,
  LGD_DISTRICTS,
  TRIPURA_DISTRICTS_NAME_ONLY,
  NER_DISTRICT_HQ_APPROX,
  lookupDistrictByLgdCode,
  findDistrictNamesInText,
  isNerState,
};
