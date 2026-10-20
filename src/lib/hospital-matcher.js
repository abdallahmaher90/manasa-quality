export function findMatchingSheetHospital(dbName, sheetHospitals) {
  if (!dbName || !sheetHospitals || sheetHospitals.length === 0) return null;

  const normalize = (s) => (s || '')
    .trim()
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[\s\-_]+/g, ' ')
    .toLowerCase();

  const normDb = normalize(dbName);

  // 1. Direct exact match
  for (const sh of sheetHospitals) {
    if (normalize(sh) === normDb) return sh;
  }

  // 2. Specialty-aware match (حميات، صدر، رمد، جلدية، أطفال، كلى)
  const specialties = ['حميات', 'صدر', 'رمد', 'جلدية', 'كلي', 'اطفال'];
  for (const spec of specialties) {
    if (normDb.includes(spec)) {
      const candidates = sheetHospitals.filter(sh => normalize(sh).includes(spec));
      // Within candidates, find city match
      for (const c of candidates) {
        const normC = normalize(c);
        const cities = ['كفر الشيخ', 'كفرالشيخ', 'دسوق', 'بيلا', 'مطوبس', 'فوه', 'سيدي سالم', 'الحامول', 'بلطيم', 'الرياض'];
        for (const city of cities) {
          if (normDb.includes(normalize(city)) && normC.includes(normalize(city))) {
            return c;
          }
        }
      }
    }
  }

  // 3. General hospitals (عام / مركزي)
  for (const sh of sheetHospitals) {
    const normSh = normalize(sh);
    const cleanDb = normDb.replace(/مستشفي|مركزي|عام/g, '').trim();
    const cleanSh = normSh.replace(/مستشفي|مركزي|عام/g, '').trim();
    if (cleanDb.length > 2 && cleanSh.length > 2 && (cleanDb === cleanSh || cleanSh.includes(cleanDb) || cleanDb.includes(cleanSh))) {
      // Ensure specialty doesn't clash
      const hasSpecialtyDb = specialties.some(s => normDb.includes(s));
      const hasSpecialtySh = specialties.some(s => normSh.includes(s));
      if (hasSpecialtyDb === hasSpecialtySh) {
        return sh;
      }
    }
  }

  return null;
}
