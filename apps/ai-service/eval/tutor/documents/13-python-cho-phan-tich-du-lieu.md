# Python cho phân tích dữ liệu với pandas

## Series và DataFrame

pandas có hai cấu trúc chính: `Series` (một cột có chỉ mục) và `DataFrame` (bảng nhiều cột). Đọc dữ liệu từ tệp CSV bằng `pd.read_csv("diem.csv")`, từ Excel bằng `pd.read_excel`.

## Xem nhanh dữ liệu

`df.head()` xem 5 dòng đầu, `df.info()` xem kiểu từng cột và số giá trị thiếu, `df.describe()` thống kê mô tả các cột số.

## Lọc và chọn

- Chọn cột: `df["diem"]` hoặc `df[["ten", "diem"]]`.
- Lọc dòng theo điều kiện: `df[df["diem"] >= 8]`.
- `df.loc[nhan, cot]` chọn theo nhãn, `df.iloc[i, j]` chọn theo vị trí.

## Sắp xếp trong pandas

`df.sort_values("diem", ascending=False)` sắp xếp các dòng theo cột điểm giảm dần; truyền danh sách cột để sắp theo nhiều tiêu chí. `sort_index()` sắp theo chỉ mục. Mặc định `sort_values` dùng quicksort, muốn sắp xếp ổn định thì truyền `kind="stable"`.

## Lặp qua các dòng

Có thể lặp bằng `for chi_so, dong in df.iterrows():`, nhưng cách này rất chậm với bảng lớn. Nên ưu tiên phép toán vector hoá như `df["tong"] = df["a"] + df["b"]` hoặc `df.apply`.

## Gom nhóm

`df.groupby("lop")["diem"].mean()` tính điểm trung bình theo lớp. `agg` cho phép tính nhiều thống kê cùng lúc: `.agg(["mean", "max", "count"])`.

## Giá trị thiếu

`df.isna().sum()` đếm giá trị thiếu mỗi cột; `dropna()` bỏ dòng thiếu, `fillna(0)` điền giá trị.

## Ghi kết quả

`df.to_csv("ket_qua.csv", index=False, encoding="utf-8-sig")` — `utf-8-sig` giúp Excel mở đúng tiếng Việt.
