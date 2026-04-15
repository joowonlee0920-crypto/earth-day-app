import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "./firebase";
import { addDoc, collection, onSnapshot, orderBy, query } from "firebase/firestore";

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
const ADMIN_PASSWORD = "earth2026";
const SCHOOL_TOTAL_STUDENTS = 1000;

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
  return value.toFixed(3);
}

function formatWon(value: number) {
  return Math.round(value).toLocaleString("ko-KR");
}

function formatCo2(value: number) {
  return value.toFixed(3);
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, "");
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getGaugeColor(percent: number) {
  if (percent < 35) return "#3bb273";
  if (percent < 70) return "#f0c419";
  return "#f25f5c";
}

function makeIcons(emoji: string, count: number) {
  return Array.from({ length: count }, (_, i) => (
    <span key={`${emoji}-${i}`} style={{ fontSize: "20px" }}>
      {emoji}
    </span>
  ));
}

function useCountUp(target: number, decimals = 0, duration = 700) {
  const [display, setDisplay] = useState(target);
  const previousRef = useRef(target);

  useEffect(() => {
    const startValue = previousRef.current;
    const endValue = target;
    const startTime = performance.now();

    const animate = (time: number) => {
      const progress = clamp((time - startTime) / duration, 0, 1);
      const value = startValue + (endValue - startValue) * progress;
      setDisplay(Number(value.toFixed(decimals)));

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        previousRef.current = endValue;
      }
    };

    requestAnimationFrame(animate);
  }, [target, decimals, duration]);

  return display;
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #0b1f1a 0%, #123b2d 48%, #1f6b49 100%)",
    color: "#f4fff8",
    fontFamily: "sans-serif",
    padding: "12px",
  } as const,
  container: {
    width: "100%",
    maxWidth: "430px",
    margin: "0 auto",
    paddingBottom: "40px",
  } as const,
  hero: {
    background: "linear-gradient(135deg, #0f5132 0%, #198754 45%, #46c27a 100%)",
    borderRadius: "24px",
    padding: "22px 18px",
    boxShadow: "0 18px 30px rgba(0,0,0,0.22)",
    border: "1px solid rgba(255,255,255,0.14)",
  } as const,
  card: {
    background: "rgba(10, 30, 22, 0.92)",
    borderRadius: "22px",
    padding: "18px",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow: "0 10px 24px rgba(0,0,0,0.16)",
    marginTop: "14px",
  } as const,
  input: {
    width: "100%",
    padding: "14px 14px",
    borderRadius: "14px",
    border: "1px solid #3e7359",
    background: "#16362b",
    color: "#ffffff",
    boxSizing: "border-box" as const,
    fontSize: "16px",
    outline: "none",
  },
  button: {
    width: "100%",
    padding: "15px 16px",
    borderRadius: "16px",
    border: "none",
    fontSize: "17px",
    fontWeight: 800,
    cursor: "pointer",
  } as const,
  smallButton: {
    padding: "10px 12px",
    borderRadius: "12px",
    border: "none",
    fontSize: "14px",
    fontWeight: 700,
    cursor: "pointer",
  } as const,
  statCard: {
    background: "#143628",
    borderRadius: "18px",
    padding: "16px",
    border: "1px solid rgba(126,240,168,0.10)",
  } as const,
};

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
  const [titleTapCount, setTitleTapCount] = useState(0);

  const [now, setNow] = useState(new Date());

  const preview = useMemo(() => calculateResult(bulbCount, bulbType), [bulbCount, bulbType]);
  const latestSubmission = submissions[submissions.length - 1] ?? null;

  useEffect(() => {
    const q = query(collection(db, "submissions"), orderBy("submittedAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Submission[];

      setSubmissions(items);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timer);
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
      setDuplicateWarning("같은 이름과 학급으로 이미 제출된 기록이 있어요. 다시 확인해 주세요.");
    } else {
      setDuplicateWarning("");
    }
  }, [name, className, submissions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("이름을 입력해 주세요.");
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

      setSuccessMessage("인증이 완료되었어요.");
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

  const animatedPeople = useCountUp(totalPeople, 0, 700);
  const animatedKwh = useCountUp(totalKwh, 2, 700);
  const animatedCo2 = useCountUp(totalCo2, 2, 700);

  const participantPercent = clamp((totalPeople / SCHOOL_TOTAL_STUDENTS) * 100, 0, 100);
  const powerPercent = clamp((totalKwh / 10) * 100, 0, 100);
  const carbonPercent = clamp((totalCo2 / 5) * 100, 0, 100);

  const participantColor = getGaugeColor(participantPercent);
  const powerColor = getGaugeColor(powerPercent);
  const carbonColor = getGaugeColor(carbonPercent);

  const powerIcons = clamp(Math.round(totalKwh * 2), 1, 8);
  const carbonIcons = clamp(Math.round(totalCo2 * 3), 1, 8);

  const currentBulbInfo = bulbConfig[bulbType];

  const isEventLive =
    now.getHours() === 20 && now.getMinutes() >= 0 && now.getMinutes() < 10;

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

  const handleTitleTap = () => {
    const next = titleTapCount + 1;
    if (next >= 5) {
      setTitleTapCount(0);
      openAdminPage();
      return;
    }
    setTitleTapCount(next);
  };

  const recentSubmissions = useMemo(() => {
    return [...submissions]
      .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
      .slice(0, 20);
  }, [submissions]);

  const gaugeBar = (percent: number, color: string) => ({
    width: `${percent}%`,
    height: "100%",
    borderRadius: "999px",
    background: `linear-gradient(90deg, ${color} 0%, ${color}cc 100%)`,
    transition: "width 0.5s ease",
  });

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.hero}>
          <div style={{ fontSize: "13px", opacity: 0.95, marginBottom: "6px" }}>🌍 Earth Day Campaign</div>

          <h1
            onClick={handleTitleTap}
            style={{
              margin: 0,
              fontSize: "28px",
              lineHeight: 1.25,
              fontWeight: 900,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            남창고 지구의 날 실천
          </h1>

          <p style={{ marginTop: "10px", marginBottom: 0, color: "#eafff1", lineHeight: 1.6, fontSize: "15px" }}>
            10분 동안 불을 끄고, 우리 학교의 실천을 함께 기록해요.
          </p>

          {isEventLive && (
            <div
              style={{
                marginTop: "14px",
                background: "rgba(255,255,255,0.16)",
                border: "1px solid rgba(255,255,255,0.22)",
                borderRadius: "16px",
                padding: "10px 12px",
                fontWeight: 800,
                fontSize: "15px",
              }}
            >
              🔴 지금 진행 중입니다 (20:00~20:10)
            </div>
          )}
        </div>

        {page === "student" ? (
          <>
            <div style={styles.card}>
              <div style={{ color: "#baf3cf", fontSize: "14px", fontWeight: 700 }}>실시간 참여 현황</div>
              <div style={{ marginTop: "8px", fontSize: "44px", fontWeight: 900, lineHeight: 1, color: "#ffffff" }}>
                {animatedPeople}
              </div>
              <div style={{ marginTop: "6px", fontSize: "16px", fontWeight: 700 }}>명 참여 중</div>

              <div style={{ marginTop: "12px", height: "12px", borderRadius: "999px", background: "#28473a", overflow: "hidden" }}>
                <div style={gaugeBar(participantPercent, participantColor)} />
              </div>

              <div style={{ marginTop: "8px", color: "#d7f7e2", fontSize: "13px" }}>
                전체 예상 참여 인원 {SCHOOL_TOTAL_STUDENTS}명 기준 {participantPercent.toFixed(1)}%
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "22px" }}>실시간 절감 효과</h2>

              <div style={{ display: "grid", gap: "12px" }}>
                <div style={styles.statCard}>
                  <div style={{ color: "#baf3cf", fontSize: "13px" }}>⚡ 누적 절감 전력</div>
                  <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{animatedKwh.toFixed(2)} kWh</div>
                  <div style={{ marginTop: "8px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {makeIcons("💡", powerIcons)}
                  </div>
                  <div style={{ marginTop: "10px", height: "10px", borderRadius: "999px", background: "#28473a", overflow: "hidden" }}>
                    <div style={gaugeBar(powerPercent, powerColor)} />
                  </div>
                </div>

                <div style={styles.statCard}>
                  <div style={{ color: "#baf3cf", fontSize: "13px" }}>🌿 누적 탄소 감소</div>
                  <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{animatedCo2.toFixed(2)} kg CO₂</div>
                  <div style={{ marginTop: "8px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {makeIcons("🌳", carbonIcons)}
                  </div>
                  <div style={{ marginTop: "10px", height: "10px", borderRadius: "999px", background: "#28473a", overflow: "hidden" }}>
                    <div style={gaugeBar(carbonPercent, carbonColor)} />
                  </div>
                </div>

                <div style={styles.statCard}>
                  <div style={{ color: "#baf3cf", fontSize: "13px" }}>💰 누적 절약 전기요금</div>
                  <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{formatWon(totalWon)}원</div>
                </div>

                <div style={styles.statCard}>
                  <div style={{ color: "#baf3cf", fontSize: "13px" }}>💡 누적 전등 수</div>
                  <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{totalBulbs}개</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h2 style={{ marginTop: 0, marginBottom: "8px", fontSize: "22px" }}>불 끄기 인증</h2>
              <p style={{ marginTop: 0, color: "#d7f7e2", lineHeight: 1.6, fontSize: "15px" }}>
                지금 계신 곳에서 10분 동안 불을 끈 뒤 아래 내용을 입력해 주세요.
              </p>

              <form onSubmit={handleSubmit}>
                <div style={{ marginTop: "16px" }}>
                  <label style={{ display: "block", marginBottom: "8px", fontWeight: 700, fontSize: "15px" }}>
                    이름
                  </label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={isSubmitting}
                    style={styles.input}
                    placeholder="이름을 입력하세요"
                  />
                </div>

                <div style={{ marginTop: "16px" }}>
                  <label style={{ display: "block", marginBottom: "8px", fontWeight: 700, fontSize: "15px" }}>
                    학급 선택
                  </label>
                  <select
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    disabled={isSubmitting}
                    style={styles.input}
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
                  <label style={{ display: "block", marginBottom: "8px", fontWeight: 700, fontSize: "15px" }}>
                    끈 전등 개수
                  </label>
                  <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setBulbCount((prev) => Math.max(1, prev - 1))}
                      style={{
                        ...styles.smallButton,
                        width: "48px",
                        height: "48px",
                        background: "#275743",
                        color: "#fff",
                        fontSize: "22px",
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
                        ...styles.input,
                        width: "110px",
                        textAlign: "center" as const,
                        padding: "12px",
                      }}
                    />
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setBulbCount((prev) => prev + 1)}
                      style={{
                        ...styles.smallButton,
                        width: "48px",
                        height: "48px",
                        background: "#275743",
                        color: "#fff",
                        fontSize: "22px",
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>

                <div style={{ marginTop: "16px" }}>
                  <label style={{ display: "block", marginBottom: "8px", fontWeight: 700, fontSize: "15px" }}>
                    전등 종류
                  </label>
                  <div style={{ display: "grid", gap: "8px" }}>
                    {(["LED", "FLUORESCENT", "UNKNOWN"] as BulbType[]).map((type) => {
                      const active = bulbType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => setBulbType(type)}
                          style={{
                            ...styles.smallButton,
                            width: "100%",
                            textAlign: "left" as const,
                            background: active ? "#214d3c" : "#16362b",
                            color: "#ffffff",
                            border: active ? "2px solid #7ef0a8" : "1px solid #3d7258",
                            padding: "13px 14px",
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
                    marginTop: "18px",
                    background: "linear-gradient(135deg, #163b2e 0%, #214d3c 100%)",
                    padding: "16px",
                    borderRadius: "18px",
                    border: "1px solid rgba(126,240,168,0.22)",
                  }}
                >
                  <div style={{ fontSize: "15px", fontWeight: 800, marginBottom: "10px" }}>미리 계산 결과</div>
                  <div style={{ fontSize: "15px", lineHeight: 1.8 }}>
                    <div>⚡ 절감 전력량: {formatKwh(preview.savedKwh)} kWh</div>
                    <div>💰 절약 전기요금: 약 {formatWon(preview.savedCostWon)}원</div>
                    <div>🌿 탄소 저감량: 약 {formatCo2(preview.savedCo2Kg)} kg CO₂</div>
                    <div style={{ marginTop: "6px", color: "#b8f5ca" }}>
                      선택한 전등 종류: {currentBulbInfo.emoji} {currentBulbInfo.label} ({currentBulbInfo.watt}W 기준)
                    </div>
                  </div>
                </div>

                {duplicateWarning && (
                  <div
                    style={{
                      marginTop: "12px",
                      background: "rgba(255, 193, 7, 0.12)",
                      color: "#ffe08a",
                      padding: "12px",
                      borderRadius: "14px",
                      fontSize: "14px",
                      lineHeight: 1.5,
                    }}
                  >
                    ⚠ {duplicateWarning}
                  </div>
                )}

                {error && (
                  <div
                    style={{
                      marginTop: "12px",
                      background: "rgba(220, 53, 69, 0.12)",
                      color: "#ffb3b3",
                      padding: "12px",
                      borderRadius: "14px",
                      fontSize: "14px",
                      lineHeight: 1.5,
                    }}
                  >
                    {error}
                  </div>
                )}

                {successMessage && (
                  <div
                    style={{
                      marginTop: "12px",
                      background: "rgba(25, 135, 84, 0.18)",
                      color: "#b7ffd1",
                      padding: "12px",
                      borderRadius: "14px",
                      fontSize: "14px",
                      fontWeight: 700,
                    }}
                  >
                    ✅ {successMessage}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  style={{
                    ...styles.button,
                    marginTop: "18px",
                    background: "linear-gradient(90deg, #1ea95f 0%, #41d67a 100%)",
                    color: "#08311f",
                    opacity: isSubmitting ? 0.7 : 1,
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  {isSubmitting ? "제출 중..." : "인증 제출하기"}
                </button>
              </form>
            </div>

            <div style={styles.card}>
              <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "22px" }}>나의 실천 결과</h2>

              {!latestSubmission ? (
                <p style={{ color: "#d7f7e2", margin: 0 }}>아직 제출한 내용이 없어요.</p>
              ) : (
                <>
                  <div
                    style={{
                      background: "linear-gradient(135deg, #123628 0%, #1b4f39 100%)",
                      borderRadius: "18px",
                      padding: "16px",
                      marginBottom: "12px",
                    }}
                  >
                    <div style={{ fontSize: "13px", color: "#baf3cf" }}>참여 정보</div>
                    <div style={{ fontSize: "22px", fontWeight: 900, marginTop: "6px" }}>
                      {latestSubmission.name} · {latestSubmission.className}
                    </div>
                    <div style={{ marginTop: "8px", color: "#dbffea", fontSize: "15px", lineHeight: 1.5 }}>
                      {bulbConfig[latestSubmission.bulbType].emoji} 전등 {latestSubmission.bulbCount}개를 10분 동안 끔
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: "10px" }}>
                    <div style={styles.statCard}>
                      <div style={{ color: "#baf3cf", fontSize: "13px" }}>⚡ 절감 전력량</div>
                      <div style={{ marginTop: "6px", fontSize: "30px", fontWeight: 900 }}>{formatKwh(latestSubmission.savedKwh)}</div>
                      <div style={{ color: "#dbffea" }}>kWh</div>
                    </div>

                    <div style={styles.statCard}>
                      <div style={{ color: "#baf3cf", fontSize: "13px" }}>💰 절약 전기요금</div>
                      <div style={{ marginTop: "6px", fontSize: "30px", fontWeight: 900 }}>{formatWon(latestSubmission.savedCostWon)}</div>
                      <div style={{ color: "#dbffea" }}>원</div>
                    </div>

                    <div style={styles.statCard}>
                      <div style={{ color: "#baf3cf", fontSize: "13px" }}>🌿 탄소 저감량</div>
                      <div style={{ marginTop: "6px", fontSize: "30px", fontWeight: 900 }}>{formatCo2(latestSubmission.savedCo2Kg)}</div>
                      <div style={{ color: "#dbffea" }}>kg CO₂</div>
                    </div>

                    <div style={styles.statCard}>
                      <div style={{ color: "#baf3cf", fontSize: "13px" }}>🕒 제출 시각</div>
                      <div style={{ marginTop: "6px", fontSize: "16px", fontWeight: 700, lineHeight: 1.5 }}>
                        {formatDateTime(latestSubmission.submittedAt)}
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                <div>
                  <h2 style={{ marginTop: 0, marginBottom: "8px", fontSize: "22px" }}>관리자 요약 화면</h2>
                  <p style={{ margin: 0, color: "#d7f7e2", fontSize: "14px", lineHeight: 1.5 }}>
                    제출 데이터는 실시간으로 반영됩니다.
                  </p>
                </div>
                <button
                  onClick={lockAdminPage}
                  style={{
                    ...styles.smallButton,
                    background: "#275743",
                    color: "#ffffff",
                    minWidth: "92px",
                  }}
                >
                  잠금
                </button>
              </div>
            </div>

            <div style={styles.card}>
              <h3 style={{ marginTop: 0, marginBottom: "12px" }}>전체 통계</h3>
              <div style={{ display: "grid", gap: "10px" }}>
                <div style={styles.statCard}>
                  <div style={{ color: "#baf3cf", fontSize: "13px" }}>총 참여 인원</div>
                  <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{totalPeople}</div>
                </div>
                <div style={styles.statCard}>
                  <div style={{ color: "#baf3cf", fontSize: "13px" }}>총 전등 수</div>
                  <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{totalBulbs}</div>
                </div>
                <div style={styles.statCard}>
                  <div style={{ color: "#baf3cf", fontSize: "13px" }}>총 절감 전력</div>
                  <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{formatKwh(totalKwh)} kWh</div>
                </div>
                <div style={styles.statCard}>
                  <div style={{ color: "#baf3cf", fontSize: "13px" }}>총 절약 요금</div>
                  <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{formatWon(totalWon)}원</div>
                </div>
                <div style={styles.statCard}>
                  <div style={{ color: "#baf3cf", fontSize: "13px" }}>총 탄소 저감</div>
                  <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{formatCo2(totalCo2)} kg</div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <h3 style={{ marginTop: 0, marginBottom: "12px" }}>최근 제출 20건</h3>
              {recentSubmissions.length === 0 ? (
                <p style={{ color: "#d7f7e2", margin: 0 }}>아직 제출된 데이터가 없습니다.</p>
              ) : (
                <div style={{ display: "grid", gap: "10px" }}>
                  {recentSubmissions.map((item) => (
                    <div key={item.id} style={styles.statCard}>
                      <div style={{ fontSize: "18px", fontWeight: 800 }}>{item.name}</div>
                      <div style={{ marginTop: "6px", color: "#dbffea", fontSize: "14px", lineHeight: 1.7 }}>
                        <div>학급: {item.className}</div>
                        <div>전등 수: {item.bulbCount}개</div>
                        <div>제출 시각: {formatDateTime(item.submittedAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showAdminModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.58)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: "390px",
              background: "#102a20",
              borderRadius: "22px",
              padding: "20px",
              border: "1px solid rgba(255,255,255,0.08)",
              boxShadow: "0 20px 40px rgba(0,0,0,0.3)",
            }}
          >
            <h3 style={{ marginTop: 0, color: "#f5fff8", fontSize: "22px" }}>관리자 화면 잠금</h3>
            <p style={{ color: "#d7f7e2", lineHeight: 1.6, fontSize: "14px" }}>
              관리자 화면에 들어가려면 비밀번호를 입력하세요.
            </p>

            <input
              type="password"
              value={adminPasswordInput}
              onChange={(e) => setAdminPasswordInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdminUnlock();
              }}
              style={styles.input}
              placeholder="비밀번호 입력"
            />

            {adminPasswordError && (
              <div
                style={{
                  marginTop: "12px",
                  background: "rgba(220, 53, 69, 0.12)",
                  color: "#ffb3b3",
                  padding: "12px",
                  borderRadius: "14px",
                  fontSize: "14px",
                }}
              >
                {adminPasswordError}
              </div>
            )}

            <div style={{ display: "flex", gap: "10px", marginTop: "18px" }}>
              <button
                onClick={() => {
                  setShowAdminModal(false);
                  setAdminPasswordInput("");
                  setAdminPasswordError("");
                }}
                style={{
                  ...styles.button,
                  background: "#275743",
                  color: "#ffffff",
                  padding: "14px",
                }}
              >
                취소
              </button>
              <button
                onClick={handleAdminUnlock}
                style={{
                  ...styles.button,
                  background: "linear-gradient(90deg, #1ea95f 0%, #41d67a 100%)",
                  color: "#08311f",
                  padding: "14px",
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