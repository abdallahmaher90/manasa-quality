import openpyxl
import sys
import os
import json
import re
import urllib.request

sys.stdout.reconfigure(encoding='utf-8')

# Read env for Supabase
def get_env_vars():
    env = {}
    try:
        with open('.env.local', 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    k, v = line.split('=', 1)
                    env[k.strip()] = v.strip().strip('"').strip("'")
    except Exception as e:
        print('Error reading .env.local:', e)
    return env

env = get_env_vars()
SUPABASE_URL = env.get('NEXT_PUBLIC_SUPABASE_URL')
SERVICE_KEY = env.get('SUPABASE_SERVICE_ROLE_KEY')

db_hospitals = [
  {'id': '70e29487-f756-4cc6-8279-d4b35315a7ca', 'name': 'مستشفى سيدي سالم المركزي'},
  {'id': '32173e7d-7b00-4347-bbc8-3ad5527c2567', 'name': 'مستشفي فيصل سعود الفليج'},
  {'id': 'fc2a6ff8-034e-4997-9805-6beda1759a06', 'name': 'مستشفى جلدية وجذام كفرالشيخ'},
  {'id': 'da69dd94-fc38-48c0-96f3-d8e025565b22', 'name': 'مستشفى الرمد الرئيسي'},
  {'id': '17bd7aef-66a3-49b7-837c-1f254f0b8cad', 'name': 'مستشفى سيدى غازى'},
  {'id': 'd257505e-92be-43a7-8971-06b83da4f02d', 'name': 'مستشفي بيلا المركزي'},
  {'id': '3b1603e2-585a-49cb-9ab0-717e11798b2c', 'name': 'مستشفى حميات دسوق'},
  {'id': 'e1552e09-40d6-4af9-bc80-53ee3f6e01fe', 'name': 'مستشفى حميات مطوبس'},
  {'id': '8ffc9f5a-fb9a-4f6b-b0af-ad3ed2d669c0', 'name': 'مستشفى كفر الشيخ العام'},
  {'id': 'a97254e2-a9b9-41f6-a313-1e29f1c82379', 'name': 'مستشفى دسوق العام'},
  {'id': '2c66b0e7-7e9a-47b2-a896-dab13201543a', 'name': 'مستشفي الحامول المركزي'},
  {'id': '8306c6ed-d448-4ec5-ab99-1990df09f4eb', 'name': 'مستشفى الرياض المركزي'},
  {'id': 'd5d501f4-4e40-463f-accd-780080857644', 'name': 'مستشفى برج البرلس المركزى'},
  {'id': '36157c87-d5b6-433b-a2bf-c8322308a100', 'name': 'مستشفى صدر كفرالشيخ'},
  {'id': 'ee4dc1f4-1602-482e-a235-554dc72c4e67', 'name': 'مستشفى فوه المركزي'},
  {'id': '71ef0e31-e170-4806-9b0d-fe370acb479b', 'name': 'مستشفى حميات كفر الشيخ'},
  {'id': '3183df43-a0e2-46ad-be8b-4c14a5b9aba7', 'name': 'مستشفى مطوبس المركزى'},
  {'id': '982945ef-7f38-4497-93d7-aeaade37cfaf', 'name': 'مستشفى حميات بيلا'}
]

def match_facility(fac_name):
    custom = [
        ('فيصل', 'مستشفي فيصل سعود الفليج'),
        ('جلديه', 'مستشفى جلدية وجذام كفرالشيخ'),
        ('جذام', 'مستشفى جلدية وجذام كفرالشيخ'),
        ('رمد', 'مستشفى الرمد الرئيسي'),
        ('صدر كفر', 'مستشفى صدر كفرالشيخ'),
        ('مستوصف صدر', 'مستشفى صدر كفرالشيخ'),
        ('فوه', 'مستشفى فوه المركزي'),
        ('مطوبس المركز', 'مستشفى مطوبس المركزى'),
        ('دسوق العام', 'مستشفى دسوق العام'),
        ('حميات دسوق', 'مستشفى حميات دسوق'),
        ('حميات مطوبس', 'مستشفى حميات مطوبس'),
        ('حميات كفر', 'مستشفى حميات كفر الشيخ'),
        ('حميات بيلا', 'مستشفى حميات بيلا'),
        ('بيلا المركز', 'مستشفي بيلا المركزي'),
        ('الحامول', 'مستشفي الحامول المركزي'),
        ('الرياض', 'مستشفى الرياض المركزي'),
        ('سيدي غاز', 'مستشفى سيدى غازى'),
        ('سيدى غاز', 'مستشفى سيدى غازى'),
        ('سيدي سالم', 'مستشفى سيدي سالم المركزي'),
        ('سيدى سالم', 'مستشفى سيدي سالم المركزي'),
        ('برج البرلس', 'مستشفى برج البرلس المركزى'),
        ('كفر الشيخ العام', 'مستشفى كفر الشيخ العام'),
    ]
    for k, v in custom:
        if k in fac_name:
            for h in db_hospitals:
                if h['name'] == v:
                    return h
    return None

DOMAINS = {
    'facility_equipment': {
        'key': 'facility_equipment',
        'label': 'سلامة وصيانة الأجهزة والمرافق',
        'icon': '⚙️',
        'color': '#d97706',
        'keywords': ['صيانة', 'معايرة', 'أجهزة', 'معدات', 'أعطال', 'ماكينات', 'أكسجين', 'غازات', 'كهرباء', 'حرائق', 'انفجار', 'دخان', 'مرافق', 'تسريب', 'صرف', 'مياه']
    },
    'medical_records': {
        'key': 'medical_records',
        'label': 'السجلات الطبية ونماذج التوثيق',
        'icon': '📁',
        'color': '#2563eb',
        'keywords': ['سجلات', 'ملفات', 'نماذج', 'شهادات', 'قوائم', 'شارت', 'رسوم بيانية', 'أوامر', 'طلبات', 'إقرارات', 'توقيع', 'اختصارات', 'بيانات المريض']
    },
    'infection_control': {
        'key': 'infection_control',
        'label': 'مكافحة العدوى والتعقيم والبيئة',
        'icon': '🦠',
        'color': '#059669',
        'keywords': ['مكافحة العدوى', 'تطهير', 'تعقيم', 'انسكاب', 'نفايات', 'عزل', 'وخز', 'إبر', 'آلات', 'غسيل', 'مفروشات', 'عدوى مكتسبة', 'ppe', 'احترازية']
    },
    'patient_safety': {
        'key': 'patient_safety',
        'label': 'سلامة وأمان المرضى',
        'icon': '🛡️',
        'color': '#dc2626',
        'keywords': ['سقوط', 'قرح', 'تعريف المريض', 'أسورة', 'تقييد', 'هروب', 'عنف', 'اعتداء', 'إيذاء', 'حقوق', 'وقت مستقطع', 'time out', 'أمان المريض']
    },
    'medication_safety': {
        'key': 'medication_safety',
        'label': 'سلامة وإدارة الأدوية',
        'icon': '💊',
        'color': '#7c3aed',
        'keywords': ['دواء', 'أدوية', 'جرعة', 'صيدلية', 'مخدرة', 'عالية الخطورة', 'تفاعلات دوائية', 'سوائل وريدية', 'توافق دوائي', 'تغليف الدواء', 'ملصقات الأدوية', 'منتهية الصلاحية', 'دم', 'مشتقات الدم']
    },
    'critical_care': {
        'key': 'critical_care',
        'label': 'النتائج الحرجة والرعاية العاجلة',
        'icon': '🚨',
        'color': '#e11d48',
        'keywords': ['نتائج حرجة', 'critical', 'إنذار', 'ترياج', 'استجابة سريعة', 'rrt', 'جلطات', 'vte', 'تنفس صناعي', 'تخدير', 'تهدئة', 'قساطر', 'أنابيب', 'عناية']
    },
    'clinical_operations': {
        'key': 'clinical_operations',
        'label': 'كفاءة العمل والالتزام بالبروتوكولات',
        'icon': '📋',
        'color': '#475569',
        'keywords': ['كفاءة', 'بروتوكول', 'مبادئ توجيهية', 'سياسات', 'لوائح', 'سلوك', 'تغذية', 'نظام غذائي', 'إحالة', 'دخول', 'خروج', 'استشارة']
    }
}

def classify_ovr(subcategory, description):
    sub = str(subcategory or '').lower()
    desc = str(description or '').lower()
    combined = f'{sub} {desc}'

    # Check direct subcategory matches first
    if any(k in sub for k in ['صيانة', 'معايرة', 'أجهزة', 'معدات', 'equipment', 'maintenance', 'utility', 'oxygen', 'غاز']):
        return DOMAINS['facility_equipment']
    if any(k in sub for k in ['سجلات', 'medical records', 'forms', 'check lists', 'charts', 'نماذج', 'ملصقات', 'بيانات المريض']):
        return DOMAINS['medical_records']
    if any(k in sub for k in ['مكافحة العدو', 'تطهير', 'تعقيم', 'infection', 'ppe', 'sterilization', 'disinfection', 'waste', 'نفايات', 'وخز', 'needle', 'spill', 'انسكاب']):
        return DOMAINS['infection_control']
    if any(k in sub for k in ['سقوط', 'fall', 'قرح', 'pressure ulcer', 'تعريف المريض', 'patient identification', 'violence', 'عنف', 'هروب', 'absconding', 'restrain', 'تقييد', 'rights']):
        return DOMAINS['patient_safety']
    if any(k in sub for k in ['دواء', 'medication', 'blood', 'دم', 'جرعة', 'dose', 'narcotic', 'adverse drug', 'iv fluids']):
        return DOMAINS['medication_safety']
    if any(k in sub for k in ['حرجة', 'critical', 'rrt', 'إنذار', 'تخدير', 'anesthesia', 'جلطات', 'vte', 'قساطر', 'catheter']):
        return DOMAINS['critical_care']
    if any(k in sub for k in ['كفاءة', 'efficiency', 'بروتوكول', 'protocol', 'guideline', 'diet', 'غذاء', 'تغذية']):
        return DOMAINS['clinical_operations']

    # Fallback to description keywords
    for domain_key, domain_info in DOMAINS.items():
        for kw in domain_info['keywords']:
            if kw in combined:
                return domain_info

    return DOMAINS['clinical_operations']

print('Loading Excel file...')
file_path = r'C:\Users\Dr Abdallah\Downloads\الإبلاغ_عن_حدث_عارض (10).xlsx'
wb = openpyxl.load_workbook(file_path, read_only=True)
sheet = wb['Sheet1']

records = []
hospital_records = {h['id']: [] for h in db_hospitals}

row_idx = 0
for r in sheet.iter_rows(values_only=True):
    row_idx += 1
    if row_idx == 1: continue
    
    desc = str(r[0] or '').strip()
    raw_date = str(r[1] or '').strip()
    fac = str(r[2] or '').strip()
    cat = str(r[3] or '').strip()
    
    # Format date
    date_str = raw_date[:10] if len(raw_date) >= 10 else raw_date
    if not date_str or date_str == 'None':
        date_str = '2026-01-01'

    matched_hosp = match_facility(fac)
    if not matched_hosp:
        print(f'Warning: unmapped facility: {fac}')
        continue

    domain_info = classify_ovr(cat, desc)

    rec = {
        'id': f'ovr_{row_idx - 1}',
        'hospital_id': matched_hosp['id'],
        'hospital_name': matched_hosp['name'],
        'facility_raw': fac,
        'date': date_str,
        'description': desc,
        'subcategory': cat,
        'domain_key': domain_info['key'],
        'domain_label': domain_info['label'],
        'domain_icon': domain_info['icon'],
        'domain_color': domain_info['color']
    }

    records.append(rec)
    hospital_records[matched_hosp['id']].append(rec)

print(f'Total processed records: {len(records)}')

# Sort records per hospital chronologically descending (newest first)
for hid in hospital_records:
    hospital_records[hid].sort(key=lambda x: x['date'], reverse=True)

# Generate Summary Index
summary = {
    'total_records': len(records),
    'date_min': min((r['date'] for r in records), default=''),
    'date_max': max((r['date'] for r in records), default=''),
    'hospitals_count': len(db_hospitals),
    'by_hospital': {},
    'by_domain': {}
}

for d_key, d_info in DOMAINS.items():
    summary['by_domain'][d_key] = {
        'key': d_key,
        'label': d_info['label'],
        'icon': d_info['icon'],
        'color': d_info['color'],
        'count': sum(1 for r in records if r['domain_key'] == d_key)
    }

for h in db_hospitals:
    h_recs = hospital_records[h['id']]
    # Calculate domain breakdown for this hospital
    dom_breakdown = {}
    for r in h_recs:
        k = r['domain_key']
        dom_breakdown[k] = dom_breakdown.get(k, 0) + 1

    summary['by_hospital'][h['id']] = {
        'hospital_id': h['id'],
        'hospital_name': h['name'],
        'count': len(h_recs),
        'latest_incident_date': h_recs[0]['date'] if h_recs else None,
        'domains': dom_breakdown
    }

# 1. Save static JSON files
os.makedirs('src/data', exist_ok=True)
with open('src/data/ovr_records.json', 'w', encoding='utf-8') as f:
    json.dump(records, f, ensure_ascii=False, indent=2)

with open('src/data/ovr_summary.json', 'w', encoding='utf-8') as f:
    json.dump(summary, f, ensure_ascii=False, indent=2)

print('Saved src/data/ovr_records.json and src/data/ovr_summary.json successfully!')

# 2. Upload to Supabase settings table
if SUPABASE_URL and SERVICE_KEY:
    print('Syncing OVR data to Supabase settings table...')
    
    def upsert_setting(key, value_obj):
        url = f'{SUPABASE_URL}/rest/v1/settings'
        val_str = json.dumps(value_obj, ensure_ascii=False)
        payload = json.dumps({
            'key': key,
            'value': val_str,
            'updated_at': 'NOW()'
        }).encode('utf-8')
        
        req = urllib.request.Request(
            f'{url}?on_conflict=key',
            data=payload,
            headers={
                'Content-Type': 'application/json',
                'apikey': SERVICE_KEY,
                'Authorization': f'Bearer {SERVICE_KEY}',
                'Prefer': 'resolution=merge-duplicates'
            },
            method='POST'
        )
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status in (200, 201)
        except Exception as e:
            print(f'Error saving setting {key}:', e)
            return False

    # Upsert summary
    upsert_setting('ovr_summary_index', summary)
    print('Uploaded ovr_summary_index')

    # Upsert each hospital data
    for h in db_hospitals:
        hid = h['id']
        h_recs = hospital_records[hid]
        success = upsert_setting(f'ovr_data:{hid}', h_recs)
        print(f'Hospital {h["name"]}: {len(h_recs)} incidents uploaded -> {"SUCCESS" if success else "FAIL"}')

print('\nALL OVR INGESTION AND SEEDING COMPLETED SUCCESSFULLY!')
