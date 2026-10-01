Phòng đào tạo cần một chương trình nhỏ để xếp loại học lực từ **điểm trung bình** của học sinh theo thang điểm 10.

Quy tắc xếp loại:

- `9 ≤ d ≤ 10` → `Xuat sac`
- `8 ≤ d < 9` → `Gioi`
- `6.5 ≤ d < 8` → `Kha`
- `5 ≤ d < 6.5` → `Trung binh`
- `0 ≤ d < 5` → `Yeu`

Nếu điểm nhỏ hơn 0 hoặc lớn hơn 10, in `Khong hop le`.

## Đầu vào

Một dòng chứa số thực `d`.

## Đầu ra

Một dòng là kết quả xếp loại, viết **không dấu** đúng như bảng trên.

## Ghi chú

Chú ý các mốc biên như `6.5`, `8` hay `9`: chúng thuộc mức cao hơn. Viết điều kiện theo thứ tự từ cao xuống thấp sẽ giúp chương trình ngắn và ít sai hơn.
