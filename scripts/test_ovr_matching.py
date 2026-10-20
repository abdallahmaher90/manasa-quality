import openpyxl
import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

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
    # Mapping table
    custom = [
        ('فيصل', 'مستشفي فيصل سعود الفليج'),
        ('جلديه', 'مستشفى جلدية وجذام كفرالشيخ'),
        ('جذام', 'مستشفى جلدية وجذام كفرالشيخ'),
        ('رمد', 'مستشفى الرمد الرئيسي'),
        ('صدر كفر', 'مستشفى صدر كفرالشيخ'),
        ('مستوصف صدر', 'مستشفى صدر كفرالشيخ'), # Dispensaries belong to Chest hospital
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

wb = openpyxl.load_workbook(r'C:\Users\Dr Abdallah\Downloads\الإبلاغ_عن_حدث_عارض (10).xlsx', read_only=True)
sheet = wb['Sheet1']
unique_facs = set()
for i, row in enumerate(sheet.iter_rows(values_only=True)):
    if i == 0: continue
    unique_facs.add(str(row[2]).strip())

print('MATCHING RESULTS:')
all_matched = True
for f in sorted(unique_facs):
    m = match_facility(f)
    if not m:
        all_matched = False
        print(f'FAILED: {f}')
    else:
        print(f'{f} => {m["name"]} ({m["id"]})')

print(f'\nAll matched: {all_matched}')
