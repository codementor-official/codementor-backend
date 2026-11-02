---
excerpt: Năm thói quen rút ngắn quãng đường từ "chạy được" tới "hiểu vì sao chạy được" khi học Spring Boot — kèm ví dụ cụ thể để thử ngay.
takeaway: Framework chỉ dễ khi bạn từng làm thủ công đúng việc nó tự động hóa. Đọc log, hỏi từng annotation, và tự dựng lại một tính năng.
---
Spring Boot lớn tới mức đọc tài liệu theo thứ tự mục lục là cách chắc chắn nhất để bỏ cuộc. Nó cũng "thông minh" tới mức bạn có thể làm ra một API chạy được mà không hiểu vì sao nó chạy — cho tới ngày nó không chạy nữa. Năm thói quen dưới đây rút ngắn quãng từ "chạy được" tới "hiểu vì sao chạy".

## 1. Đọc log khởi động, đừng lướt qua nó

Mỗi lần khởi động, Spring Boot in ra cổng nó mở, profile đang dùng, kết nối cơ sở dữ liệu, và cảnh báo về cấu hình. Phần lớn người mới cuộn qua đoạn này để tìm dòng `Started Application`.

Bật báo cáo tự cấu hình một lần:

```properties
# application.properties
debug=true
```

Rồi đọc phần **CONDITIONS EVALUATION REPORT**. Mục *Positive matches* liệt kê mọi cấu hình tự động đã kích hoạt và vì sao — ví dụ `DataSourceAutoConfiguration matched: @ConditionalOnClass found required class 'javax.sql.DataSource'`. Đó là câu trả lời trực tiếp cho "vì sao tôi không viết dòng nào mà nó vẫn kết nối được cơ sở dữ liệu". Mục *Negative matches* thì giải thích vì sao một thứ bạn mong đợi lại không xuất hiện.

## 2. Một annotation, một câu hỏi

Gặp annotation mới, đừng chỉ chép vào. Hỏi ít nhất một câu cụ thể về nó. Với `@Transactional`:

- Giao dịch bắt đầu và kết thúc ở đâu? — Ở ranh giới lời gọi phương thức, qua proxy.
- Ngoại lệ nào thì rollback? — Mặc định chỉ `RuntimeException` và `Error`, không phải checked exception.
- Gọi phương thức `@Transactional` từ chính lớp đó thì sao? — Không đi qua proxy, nên annotation không có tác dụng.

```java
@Service
public class OrderService {
    @Transactional
    public void placeOrder(Order order) throws IOException {
        orderRepository.save(order);
        invoiceClient.send(order); // ném IOException (checked)
        // → mặc định KHÔNG rollback: đơn đã lưu dù hoá đơn gửi lỗi
    }
}
```

Riêng hai câu cuối đã đủ giải thích phần lớn lỗi "dữ liệu không được lưu mà chẳng báo gì" hoặc "lỗi rồi mà dữ liệu vẫn lưu". Muốn rollback cả checked exception, khai báo rõ: `@Transactional(rollbackFor = Exception.class)`.

## 3. Tách cấu hình khỏi mã ngay từ bài tập đầu

Chuỗi kết nối, khoá API, tên hàng đợi — cho hết vào `application.yml` và đọc qua một lớp cấu hình có kiểu:

```java
@ConfigurationProperties(prefix = "payment")
public record PaymentProperties(String baseUrl, Duration timeout, String apiKey) {}
```

```yaml
payment:
  base-url: https://sandbox.example.com
  timeout: 5s
  api-key: ${PAYMENT_API_KEY}
```

Khoá bí mật đọc từ biến môi trường, không nằm trong file commit. Làm quen từ dự án nhỏ thì lúc phải chạy cùng lúc ba môi trường (dev, staging, production) bằng profile, bạn đã có sẵn thói quen thay vì phải sửa lại toàn bộ.

## 4. Viết test cho tầng service trước tầng controller

Controller test cần dựng cả web context và chạy chậm. Service test là JUnit thuần, chạy trong mili giây, và bắt được đúng loại lỗi hay gặp nhất: logic nghiệp vụ sai.

```java
class DiscountServiceTest {
    private final DiscountService service = new DiscountService();

    @Test
    void neverChargesBelowZero() {
        assertThat(service.apply(50_000, 60_000)).isZero();
    }
}
```

Để controller test (`@WebMvcTest`) cho phần định tuyến, kiểm tra đầu vào và mã trạng thái HTTP. Chia như vậy, bộ test vừa nhanh vừa chỉ ra chính xác tầng nào hỏng.

## 5. Dựng lại một tính năng đã có bằng tay

Tự viết một bộ lọc xác thực đơn giản trước khi dùng Spring Security:

```java
@Component
public class ApiKeyFilter extends OncePerRequestFilter {
    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        if (!"secret".equals(req.getHeader("X-Api-Key"))) {
            res.sendError(HttpServletResponse.SC_UNAUTHORIZED);
            return;
        }
        chain.doFilter(req, res);
    }
}
```

Không phải để dùng bản tự viết trong dự án thật, mà để khi đọc tài liệu Spring Security bạn biết nó đang thay bạn làm gì: một chuỗi filter, mỗi filter quyết định cho request đi tiếp hay chặn lại. Làm tương tự với một repository viết bằng JDBC thuần trước khi dùng Spring Data JPA — bạn sẽ hiểu ngay câu SQL mà JPA sinh ra.

## Một lộ trình học gợi ý

1. REST controller trả JSON, kiểm tra đầu vào bằng `@Valid`.
2. Service + repository với Spring Data JPA, đọc câu SQL sinh ra (`spring.jpa.show-sql=true`).
3. Xử lý lỗi tập trung bằng `@RestControllerAdvice`.
4. Giao dịch và test tầng service.
5. Xác thực bằng Spring Security sau khi đã tự viết một filter.

## Tóm tắt

Học Spring Boot hiệu quả không phải là học thuộc annotation, mà là hiểu cơ chế đằng sau chúng: đọc báo cáo tự cấu hình, đặt câu hỏi cho từng annotation, tách cấu hình, test đúng tầng và tự dựng lại một tính năng. Framework chỉ dễ khi bạn từng làm thủ công đúng việc nó tự động hóa.
