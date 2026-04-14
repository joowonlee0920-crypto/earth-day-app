import { useEffect, useMemo, useState } from "react";
import { db } from "./firebase";
import { collection, addDoc, getDocs } from "firebase/firestore";

type BulbType = "LED" | "FLUORESCENT" | "UNKNOWN";

type Submission = {
  id: string;
  name: string;
  className: string;
  bulbCount: number;
  bulbType: BulbType;
  durationMinutes: number;
  wattPerBulb: number;
  savedKwh: number;
  savedCostWon: number;
  savedCo2Kg: number;
  submittedAt: string;
};

const DURATION_MINUTES = 10;
const COST_PER_KWH = 200;
const CO2_PER_KWH = 0.424;

// 관리자 비밀번호: 원하는 값으로 바꿔서 사용
const ADMIN_PASSWORD = "earth2026";

// 학급 목록
const CLASS_OPTIONS = [
  "1-1", "1-2", "1-3", "1-4", "1-5", "1-6", "1-7", "1-8", "1-9", "1-10", "1-11", "1-12",
  "2-1", "2-2", "2-3", "2-4", "2-5", "2-6", "2-7", "2-8", "2-9", "2-10", "2-11",
  "3-1", "3-2", "3-3", "3-4", "3-5", "3-6", "3-7", "3-8", "3-9", "3-10", "3-11",
] as const;

const bulbConfig: Record<BulbType, { label: string; watt: number; emoji: string }> = {
  LED: { label: "LED", watt: 10, emoji: "💡" },
  FLUORESCENT: { label: "형광등", watt: 20, emoji: "🔆" },
  UNKNOWN: { label: "모르겠음", watt: 15, emoji: "❓" },
};

function calculateResult(bulbCount: number, bulbType: BulbType) {
  const wattPerBulb = bulbConfig[bulbType].watt;
  const savedKwh = (bulbCount * wattPerBulb * (DURATION_MINUTES / 60)) / 1000;
  const savedCostWon = savedKwh * COST_PER_KWH;
  const savedCo2Kg = savedKwh * CO2_PER_KWH;

  return {
    wattPerBulb,
    savedKwh,
    savedCostWon,
    savedCo2Kg,
  };
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ko-KR");
}

function formatKwh(value: number) {
  return value.toFixed(4);
}

function formatWon(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function formatCo2(value: number) {
  return value.toFixed(4);
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, "");
}

function App() {
  const [page, setPage] = useState<"student" | "admin">("student");
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [name, setName] = useState("");
  const [className, setClassName] = useState("");
  const [bulbCount, setBulbCount] = useState(1);
  const [bulbType, setBulbType] = useState<BulbType>("LED");
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminPasswordError, setAdminPasswordError] = useState("");

  const preview = useMemo(() => calculateResult(bulbCount, bulbType), [bulbCount, bulbType]);
  const latestSubmission = submissions[submissions.length - 1] ?? null;

  const loadSubmissions = async () => {
    const snapshot = await getDocs(collection(db, "submissions"));

    const items = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    })) as Submission[];

    const sorted = items.sort(
      (a, b) => new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
    );

    setSubmissions(sorted);
  };

  useEffect(() => {
    loadSubmissions().catch((err) => {
      console.error("제출 데이터 불러오기 실패:", err);
    });
  }, []);

  const hasDuplicateSubmission = (studentName: string, selectedClass: string) => {
    const normalizedTarget = normalizeName(studentName);

    return submissions.some(
      (item) =>
        normalizeName(item.name) === normalizedTarget &&
        item.className === selectedClass
    );
  };

  useEffect(() => {
    if (!name.trim() || !className) {
      setDuplicateWarning("");
      return;
    }

    if (hasDuplicateSubmission(name, className)) {
      setDuplicateWarning("같은 이름과 학급으로 이미 제출된 기록이 있어요. 다시 제출하기 전에 확인해 주세요.");
    } else {
      setDuplicateWarning("");
    }
  }, [name, className, submissions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("이름 또는 닉네임을 입력해 주세요.");
      setSuccessMessage("");
      return;
    }

    if (!className) {
      setError("학급을 선택해 주세요.");
      setSuccessMessage("");
      return;
    }

    if (bulbCount < 1) {
      setError("전등 개수는 1개 이상이어야 해요.");
      setSuccessMessage("");
      return;
    }

    if (hasDuplicateSubmission(name, className)) {
      setError("중복 제출이 의심됩니다. 같은 이름과 학급으로 이미 제출된 기록이 있어요.");
      setSuccessMessage("");
      return;
    }

    setError("");
    setSuccessMessage("");
    setIsSubmitting(true);

    try {
      const result = calculateResult(bulbCount, bulbType);

      const submission = {
        name: name.trim(),
        className,
        bulbCount,
        bulbType,
        durationMinutes: DURATION_MINUTES,
        wattPerBulb: result.wattPerBulb,
        savedKwh: result.savedKwh,
        savedCostWon: result.savedCostWon,
        savedCo2Kg: result.savedCo2Kg,
        submittedAt: new Date().toISOString(),
      };

      await addDoc(collection(db, "submissions"), submission);
      await loadSubmissions();

      setSuccessMessage("인증이 완료되었어요. 지구를 위한 10분 실천이 기록되었습니다.");
      setName("");
      setClassName("");
      setBulbCount(1);
      setBulbType("LED");
      setDuplicateWarning("");
    } catch (err) {
      console.error("제출 저장 실패:", err);
      setError("제출 중 오류가 발생했어요. 다시 시도해 주세요.");
      setSuccessMessage("");
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalPeople = submissions.length;
  const totalBulbs = submissions.reduce((sum, s) => sum + s.bulbCount, 0);
  const totalKwh = submissions.reduce((sum, s) => sum + s.savedKwh, 0);
  const totalWon = submissions.reduce((sum, s) => sum + s.savedCostWon, 0);
  const totalCo2 = submissions.reduce((sum, s) => sum + s.savedCo2Kg, 0);

  const classSummary = useMemo(() => {
    const summaryMap = new Map<
      string,
      {
        className: string;
        people: number;
        bulbs: number;
        kwh: number;
        won: number;
        co2: number;
      }
    >();

    for (const item of submissions) {
      const current = summaryMap.get(item.className) ?? {
        className: item.className,
        people: 0,
        bulbs: 0,
        kwh: 0,
        won: 0,
        co2: 0,
      };

      current.people += 1;
      current.bulbs += item.bulbCount;
      current.kwh += item.savedKwh;
      current.won += item.savedCostWon;
      current.co2 += item.savedCo2Kg;

      summaryMap.set(item.className, current);
    }

    return Array.from(summaryMap.values()).sort((a, b) => {
      if (b.kwh !== a.kwh) return b.kwh - a.kwh;
      if (b.people !== a.people) return b.people - a.people;
      return a.className.localeCompare(b.className, "ko");
    });
  }, [submissions]);

  const recentSubmissions = useMemo(() => {
    return [...submissions]
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
      .slice(0, 20);
  }, [submissions]);

  const currentBulbInfo = bulbConfig[bulbType];

  const openAdminPage = () => {
    if (isAdminUnlocked) {
      setPage("admin");
      return;
    }
    setAdminPasswordInput("");
    setAdminPasswordError("");
    setShowAdminModal(true);
  };

  const handleAdminUnlock = () => {
    if (adminPasswordInput === ADMIN_PASSWORD) {
      setIsAdminUnlocked(true);
      setShowAdminModal(false);
      setAdminPasswordError("");
      setPage("admin");
    } else {
      setAdminPasswordError("비밀번호가 올바르지 않습니다.");
    }
  };

  const lockAdminPage = () => {
    setIsAdminUnlocked(false);
    setPage("student");
    setAdminPasswordInput("");
    setAdminPasswordError("");
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #0b1f1a 0%, #113b2d 45%, #1e5a42 100%)",
        padding: "24px",
        fontFamily: "sans-serif",
        color: "#f4fff8",
      }}
    >
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div
          style={{
            background: "linear-gradient(135deg, #0f5132 0%, #198754 40%, #2fbf71 100%)",
            color: "white",
            borderRadius: "28px",
            padding: "28px",
            marginBottom: "24px",
            boxShadow: "0 20px 40px rgba(0,0,0,0.25)",
            border: "1px solid rgba(255,255,255,0.15)",
          }}
        >
          <div>
            <div style={{ fontSize: "14px", opacity: 0.9, marginBottom: "8px" }}>🌍 Earth Day Campaign</div>
            <h1 style={{ margin: 0, fontSize: "34px", fontWeight: 800 }}>남창고 지구의 날 실천</h1>
            <p style={{ marginTop: "10px", color: "#eafff1", lineHeight: 1.6 }}>
              10분 동안 불을 끄고 인증해요. 우리 학교의 지구의 날 실천을 함께 기록해 보세요.
            </p>
          </div>

          <div style={{ marginTop: "18px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
            <button
              onClick={() => setPage("student")}
              style={{
                padding: "10px 18px",
                borderRadius: "14px",
                border: "none",
                cursor: "pointer",
                background: page === "student" ? "#ffffff" : "rgba(255,255,255,0.18)",
                color: page === "student" ? "#0f5132" : "#ffffff",
                fontWeight: 800,
              }}
            >
              학생 화면
            </button>
            <button
              onClick={openAdminPage}
              style={{
                padding: "10px 18px",
                borderRadius: "14px",
                border: "none",
                cursor: "pointer",
                background: page === "admin" ? "#ffffff" : "rgba(255,255,255,0.18)",
                color: page === "admin" ? "#0f5132" : "#ffffff",
                fontWeight: 800,
              }}
            >
              관리자 화면
            </button>
          </div>
        </div>

        {page === "student" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1.05fr 1fr", gap: "20px" }}>
            <div
              style={{
                background: "rgba(11, 28, 22, 0.88)",
                borderRadius: "24px",
                padding: "24px",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 12px 24px rgba(0,0,0,0.2)",
              }}
            >
              <h2 style={{ marginTop: 0, color: "#f5fff8" }}>불 끄기 인증</h2>
              <p style={{ color: "#d7f7e2", lineHeight: 1.6 }}>
                집에서 10분 동안 불을 끈 뒤, 이름과 학급을 선택하고 인증을 제출해 주세요.
              </p>

              <form onSubmit={handleSubmit}>
                <div style={{ marginTop: "16px" }}>
                  <label style={{ display: "block", marginBottom: "6px", color: "#e9fff1", fontWeight: 700 }}>이름 또는 닉네임</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isSubmitting}
                    style={{
                      width: "100%",
                      padding: "12px",
                      borderRadius: "12px",
                      border: "1px solid #3d7258",
                      background: "#16362b",
                      color: "#ffffff",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div style={{ marginTop: "16px" }}>
                  <label style={{ display: "block", marginBottom: "6px", color: "#e9fff1", fontWeight: 700 }}>학급 선택</label>
                  <select
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    disabled={isSubmitting}
                    style={{
                      width: "100%",
                      padding: "12px",
                      borderRadius: "12px",
                      border: "1px solid #3d7258",
                      background: "#16362b",
                      color: "#ffffff",
                      boxSizing: "border-box",
                    }}
                  >
                    <option value="">학급을 선택하세요</option>
                    {CLASS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ marginTop: "16px" }}>
                  <label style={{ display: "block", marginBottom: "6px", color: "#e9fff1", fontWeight: 700 }}>끈 전등 개수</label>
                  <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setBulbCount((prev) => Math.max(1, prev - 1))}
                      style={{
                        width: "42px",
                        borderRadius: "10px",
                        border: "none",
                        background: "#275743",
                        color: "#fff",
                        fontSize: "18px",
                        cursor: "pointer",
                      }}
                    >
                      -
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={bulbCount}
                      disabled={isSubmitting}
                      onChange={(e) => setBulbCount(Math.max(1, Number(e.target.value) || 1))}
                      style={{
                        width: "120px",
                        padding: "10px",
                        borderRadius: "10px",
                        border: "1px solid #3d7258",
                        background: "#16362b",
                        color: "#ffffff",
                      }}
                    />
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setBulbCount((prev) => prev + 1)}
                      style={{
                        width: "42px",
                        borderRadius: "10px",
                        border: "none",
                        background: "#275743",
                        color: "#fff",
                        fontSize: "18px",
                        cursor: "pointer",
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: "16px" }}>
                  <label style={{ display: "block", marginBottom: "6px", color: "#e9fff1", fontWeight: 700 }}>전등 종류</label>
                  <div style={{ display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" }}>
                    {(["LED", "FLUORESCENT", "UNKNOWN"] as BulbType[]).map((type) => {
                      const active = bulbType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setBulbType(type)}
                          style={{
                            padding: "10px 14px",
                            borderRadius: "12px",
                            border: active ? "2px solid #7ef0a8" : "1px solid #3d7258",
                            background: active ? "#204c39" : "#16362b",
                            color: "#ffffff",
                            cursor: "pointer",
                            fontWeight: active ? 800 : 500,
                          }}
                        >
                          {bulbConfig[type].emoji} {bulbConfig[type].label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "20px",
                    background: "linear-gradient(135deg, #163b2e 0%, #214d3c 100%)",
                    padding: "16px",
                    borderRadius: "16px",
                    border: "1px solid rgba(126,240,168,0.25)",
                  }}
                >
                  <p style={{ marginTop: 0, color: "#f5fff8" }}><strong>미리 계산 결과</strong></p>
                  <p style={{ color: "#dbffea" }}>⚡ 절감 전력량: {formatKwh(preview.savedKwh)} kWh</p>
                  <p style={{ color: "#dbffea" }}>💰 절약 전기요금: 약 {formatWon(preview.savedCostWon)}원</p>
                  <p style={{ color: "#dbffea" }}>🌿 탄소 저감량: 약 {formatCo2(preview.savedCo2Kg)} kg CO₂</p>
                  <p style={{ color: "#b8f5ca", marginBottom: 0 }}>
                    선택한 전등 종류: {currentBulbInfo.emoji} {currentBulbInfo.label} ({currentBulbInfo.watt}W 기준)
                  </p>
                </div>

                {duplicateWarning && (
                  <p
                    style={{
                      color: "#ffe08a",
                      marginTop: "12px",
                      background: "rgba(255, 193, 7, 0.12)",
                      padding: "10px 12px",
                      borderRadius: "10px",
                    }}
                  >
                    ⚠ {duplicateWarning}
                  </p>
                )}

                {error && (
                  <p
                    style={{
                      color: "#ffb3b3",
                      marginTop: "12px",
                      background: "rgba(220, 53, 69, 0.12)",
                      padding: "10px 12px",
                      borderRadius: "10px",
                    }}
                  >
                    {error}
                  </p>
                )}

                {successMessage && (
                  <p
                    style={{
                      color: "#b7ffd1",
                      marginTop: "12px",
                      fontWeight: 700,
                      background: "rgba(25, 135, 84, 0.18)",
                      padding: "10px 12px",
                      borderRadius: "10px",
                    }}
                  >
                    ✅ {successMessage}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    marginTop: "20px",
                    width: "100%",
                    padding: "15px",
                    background: "linear-gradient(90deg, #1ea95f 0%, #41d67a 100%)",
                    color: "#08311f",
                    border: "none",
                    borderRadius: "14px",
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                    opacity: isSubmitting ? 0.7 : 1,
                    fontWeight: 900,
                    fontSize: "16px",
                  }}
                >
                  {isSubmitting ? "제출 중..." : "인증 제출하기"}
                </button>
              </form>
            </div>

            <div style={{ display: "grid", gap: "20px" }}>
              <div
                style={{
                  background: "rgba(11, 28, 22, 0.88)",
                  borderRadius: "24px",
                  padding: "24px",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <h2 style={{ marginTop: 0, color: "#f5fff8" }}>나의 실천 결과</h2>

                {!latestSubmission ? (
                  <p style={{ color: "#d7f7e2" }}>아직 제출한 내용이 없어요.</p>
                ) : (
                  <div style={{ display: "grid", gap: "14px" }}>
                    <div
                      style={{
                        background: "linear-gradient(135deg, #123628 0%, #1b4f39 100%)",
                        borderRadius: "18px",
                        padding: "18px",
                        border: "1px solid rgba(126,240,168,0.2)",
                      }}
                    >
                      <div style={{ fontSize: "14px", color: "#baf3cf" }}>참여 정보</div>
                      <div style={{ marginTop: "8px", fontSize: "24px", fontWeight: 800 }}>
                        {latestSubmission.name} · {latestSubmission.className}
                      </div>
                      <div style={{ marginTop: "8px", color: "#dbffea" }}>
                        {bulbConfig[latestSubmission.bulbType].emoji} 전등 {latestSubmission.bulbCount}개를 10분 동안 끔
                      </div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                      <div style={{ background: "#143628", borderRadius: "16px", padding: "16px" }}>
                        <div style={{ fontSize: "13px", color: "#baf3cf" }}>⚡ 절감 전력량</div>
                        <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900, color: "#ffffff" }}>
                          {formatKwh(latestSubmission.savedKwh)}
                        </div>
                        <div style={{ color: "#dbffea" }}>kWh</div>
                      </div>

                      <div style={{ background: "#143628", borderRadius: "16px", padding: "16px" }}>
                        <div style={{ fontSize: "13px", color: "#baf3cf" }}>💰 절약 전기요금</div>
                        <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900, color: "#ffffff" }}>
                          {formatWon(latestSubmission.savedCostWon)}
                        </div>
                        <div style={{ color: "#dbffea" }}>원</div>
                      </div>

                      <div style={{ background: "#143628", borderRadius: "16px", padding: "16px" }}>
                        <div style={{ fontSize: "13px", color: "#baf3cf" }}>🌿 탄소 저감량</div>
                        <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900, color: "#ffffff" }}>
                          {formatCo2(latestSubmission.savedCo2Kg)}
                        </div>
                        <div style={{ color: "#dbffea" }}>kg CO₂</div>
                      </div>

                      <div style={{ background: "#143628", borderRadius: "16px", padding: "16px" }}>
                        <div style={{ fontSize: "13px", color: "#baf3cf" }}>🕒 제출 시각</div>
                        <div style={{ marginTop: "6px", fontSize: "16px", fontWeight: 700, color: "#ffffff", lineHeight: 1.5 }}>
                          {formatDateTime(latestSubmission.submittedAt)}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{
                  background: "rgba(11, 28, 22, 0.88)",
                  borderRadius: "24px",
                  padding: "24px",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <h2 style={{ marginTop: 0, color: "#f5fff8" }}>실시간 학교 통계</h2>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
                  <div style={{ background: "#143628", borderRadius: "16px", padding: "16px" }}>
                    <div style={{ color: "#baf3cf", fontSize: "13px" }}>👥 참여 인원</div>
                    <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{totalPeople}</div>
                    <div style={{ color: "#dbffea" }}>명</div>
                  </div>
                  <div style={{ background: "#143628", borderRadius: "16px", padding: "16px" }}>
                    <div style={{ color: "#baf3cf", fontSize: "13px" }}>💡 끈 전등 수</div>
                    <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{totalBulbs}</div>
                    <div style={{ color: "#dbffea" }}>개</div>
                  </div>
                  <div style={{ background: "#143628", borderRadius: "16px", padding: "16px" }}>
                    <div style={{ color: "#baf3cf", fontSize: "13px" }}>⚡ 총 절감 전력</div>
                    <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{formatKwh(totalKwh)}</div>
                    <div style={{ color: "#dbffea" }}>kWh</div>
                  </div>
                  <div style={{ background: "#143628", borderRadius: "16px", padding: "16px" }}>
                    <div style={{ color: "#baf3cf", fontSize: "13px" }}>🌿 총 탄소 저감</div>
                    <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{formatCo2(totalCo2)}</div>
                    <div style={{ color: "#dbffea" }}>kg CO₂</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "20px" }}>
            <div
              style={{
                background: "rgba(11, 28, 22, 0.88)",
                borderRadius: "24px",
                padding: "24px",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div>
                  <h2 style={{ marginTop: 0, marginBottom: "8px", color: "#f5fff8" }}>관리자 요약 화면</h2>
                  <p style={{ color: "#d7f7e2", margin: 0 }}>제출 데이터는 Firebase에 저장되며 새로고침 후에도 유지됩니다.</p>
                </div>
                <button
                  onClick={lockAdminPage}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "12px",
                    border: "none",
                    background: "#275743",
                    color: "#ffffff",
                    cursor: "pointer",
                    fontWeight: 700,
                  }}
                >
                  관리자 잠금
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "12px", marginTop: "20px" }}>
                <div style={{ background: "#143628", padding: "16px", borderRadius: "16px" }}>
                  <p style={{ color: "#baf3cf" }}>총 참여 인원</p>
                  <h3 style={{ color: "#fff", fontSize: "28px" }}>{totalPeople}</h3>
                </div>
                <div style={{ background: "#143628", padding: "16px", borderRadius: "16px" }}>
                  <p style={{ color: "#baf3cf" }}>총 전등 수</p>
                  <h3 style={{ color: "#fff", fontSize: "28px" }}>{totalBulbs}</h3>
                </div>
                <div style={{ background: "#143628", padding: "16px", borderRadius: "16px" }}>
                  <p style={{ color: "#baf3cf" }}>총 절감 전력</p>
                  <h3 style={{ color: "#fff", fontSize: "28px" }}>{formatKwh(totalKwh)} kWh</h3>
                </div>
                <div style={{ background: "#143628", padding: "16px", borderRadius: "16px" }}>
                  <p style={{ color: "#baf3cf" }}>총 절약 요금</p>
                  <h3 style={{ color: "#fff", fontSize: "28px" }}>{formatWon(totalWon)}원</h3>
                </div>
                <div style={{ background: "#143628", padding: "16px", borderRadius: "16px" }}>
                  <p style={{ color: "#baf3cf" }}>총 탄소 저감</p>
                  <h3 style={{ color: "#fff", fontSize: "28px" }}>{formatCo2(totalCo2)} kg</h3>
                </div>
              </div>

              <h3 style={{ marginTop: "28px", color: "#f5fff8" }}>학급별 순위</h3>
              {classSummary.length === 0 ? (
                <p style={{ color: "#d7f7e2" }}>아직 제출된 데이터가 없습니다.</p>
              ) : (
                <table style={{ width: "100%", marginTop: "12px", borderCollapse: "collapse", color: "#ffffff" }}>
                  <thead>
                    <tr>
                      <th style={{ borderBottom: "1px solid #2f6b52", padding: "10px" }}>순위</th>
                      <th style={{ borderBottom: "1px solid #2f6b52", padding: "10px" }}>학급</th>
                      <th style={{ borderBottom: "1px solid #2f6b52", padding: "10px" }}>참여 인원</th>
                      <th style={{ borderBottom: "1px solid #2f6b52", padding: "10px" }}>전등 수</th>
                      <th style={{ borderBottom: "1px solid #2f6b52", padding: "10px" }}>절감 전력</th>
                      <th style={{ borderBottom: "1px solid #2f6b52", padding: "10px" }}>절약 요금</th>
                    </tr>
                  </thead>
                  <tbody>
                    {classSummary.map((item, index) => (
                      <tr key={item.className}>
                        <td style={{ borderBottom: "1px solid #224735", padding: "10px" }}>{index + 1}</td>
                        <td style={{ borderBottom: "1px solid #224735", padding: "10px" }}>{item.className}</td>
                        <td style={{ borderBottom: "1px solid #224735", padding: "10px" }}>{item.people}</td>
                        <td style={{ borderBottom: "1px solid #224735", padding: "10px" }}>{item.bulbs}</td>
                        <td style={{ borderBottom: "1px solid #224735", padding: "10px" }}>{formatKwh(item.kwh)} kWh</td>
                        <td style={{ borderBottom: "1px solid #224735", padding: "10px" }}>{formatWon(item.won)}원</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div
              style={{
                background: "rgba(11, 28, 22, 0.88)",
                borderRadius: "24px",
                padding: "24px",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <h2 style={{ marginTop: 0, color: "#f5fff8" }}>최근 제출 20건</h2>
              {recentSubmissions.length === 0 ? (
                <p style={{ color: "#d7f7e2" }}>아직 제출된 데이터가 없습니다.</p>
              ) : (
                <table style={{ width: "100%", marginTop: "12px", borderCollapse: "collapse", color: "#ffffff" }}>
                  <thead>
                    <tr>
                      <th style={{ borderBottom: "1px solid #2f6b52", padding: "10px" }}>이름</th>
                      <th style={{ borderBottom: "1px solid #2f6b52", padding: "10px" }}>학급</th>
                      <th style={{ borderBottom: "1px solid #2f6b52", padding: "10px" }}>전등 수</th>
                      <th style={{ borderBottom: "1px solid #2f6b52", padding: "10px" }}>제출 시각</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentSubmissions.map((item) => (
                      <tr key={item.id}>
                        <td style={{ borderBottom: "1px solid #224735", padding: "10px" }}>{item.name}</td>
                        <td style={{ borderBottom: "1px solid #224735", padding: "10px" }}>{item.className}</td>
                        <td style={{ borderBottom: "1px solid #224735", padding: "10px" }}>{item.bulbCount}</td>
                        <td style={{ borderBottom: "1px solid #224735", padding: "10px" }}>{formatDateTime(item.submittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      {showAdminModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "20px",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "420px",
              background: "#102a20",
              borderRadius: "20px",
              padding: "24px",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
            }}
          >
            <h3 style={{ marginTop: 0, color: "#f5fff8" }}>관리자 화면 잠금</h3>
            <p style={{ color: "#d7f7e2", lineHeight: 1.6 }}>
              관리자 화면에 들어가려면 비밀번호를 입력하세요.
            </p>

            <input
              type="password"
              value={adminPasswordInput}
              onChange={(e) => setAdminPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdminUnlock();
              }}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "12px",
                border: "1px solid #3d7258",
                background: "#16362b",
                color: "#ffffff",
                boxSizing: "border-box",
              }}
            />

            {adminPasswordError && (
              <p
                style={{
                  marginTop: "12px",
                  color: "#ffb3b3",
                  background: "rgba(220, 53, 69, 0.12)",
                  padding: "10px 12px",
                  borderRadius: "10px",
                }}
              >
                {adminPasswordError}
              </p>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              <button
                onClick={() => {
                  setShowAdminModal(false);
                  setAdminPasswordInput("");
                  setAdminPasswordError("");
                }}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "12px",
                  border: "none",
                  background: "#275743",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontWeight: 700,
                }}
              >
                취소
              </button>
              <button
                onClick={handleAdminUnlock}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: "12px",
                  border: "none",
                  background: "linear-gradient(90deg, #1ea95f 0%, #41d67a 100%)",
                  color: "#08311f",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;