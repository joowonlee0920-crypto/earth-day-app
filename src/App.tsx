import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { db } from "./firebase";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
} from "firebase/firestore";

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
const MAX_BULB_COUNT = 20;

const ADMIN_PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD ?? "";

const EVENT_TARGET_STUDENTS = 300;
const POWER_TARGET_KWH = 2.5;
const CO2_TARGET_KG = 1.0;

const CLASS_OPTIONS = [
  "1-1",
  "1-2",
  "1-3",
  "1-4",
  "1-5",
  "1-6",
  "1-7",
  "1-8",
  "1-9",
  "1-10",
  "1-11",
  "1-12",
  "2-1",
  "2-2",
  "2-3",
  "2-4",
  "2-5",
  "2-6",
  "2-7",
  "2-8",
  "2-9",
  "2-10",
  "2-11",
  "3-1",
  "3-2",
  "3-3",
  "3-4",
  "3-5",
  "3-6",
  "3-7",
  "3-8",
  "3-9",
  "3-10",
  "3-11",
] as const;

const bulbConfig: Record<BulbType, { label: string; watt: number; emoji: string }> = {
  LED: { label: "LED", watt: 10, emoji: "💡" },
  FLUORESCENT: { label: "형광등", watt: 20, emoji: "🔆" },
  UNKNOWN: { label: "잘 모르겠어요", watt: 15, emoji: "❓" },
};

const LAST_SUBMISSION_STORAGE_KEY = "earth-day-last-submission";
const DEVICE_SUBMITTED_STORAGE_KEY = "earth-day-device-submitted";

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
  if (percent < 35) return "#7adbc1";
  if (percent < 70) return "#8bc5ff";
  return "#b59bff";
}

function getSubmissionDocId(className: string, name: string) {
  return `${className}-${normalizeName(name)}`;
}

function getMaskedName(name: string) {
  if (name.length <= 1) return name;
  if (name.length === 2) return `${name[0]}*`;
  return `${name[0]}*${name[name.length - 1]}`;
}

function downloadCsv(submissions: Submission[]) {
  const header = [
    "이름",
    "학급",
    "전등 수",
    "전등 종류",
    "절감 전력(kWh)",
    "탄소 저감(kg)",
    "제출 시각",
  ];

  const rows = submissions.map((item) => [
    item.name,
    item.className,
    item.bulbCount,
    bulbConfig[item.bulbType].label,
    item.savedKwh.toFixed(3),
    item.savedCo2Kg.toFixed(3),
    item.submittedAt,
  ]);

  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "earth-day-submissions.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

const styles = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(180deg, #f7fcff 0%, #eefaf7 45%, #f7f2ff 100%)",
    color: "#27444d",
    fontFamily: "Pretendard, system-ui, sans-serif",
    padding: "18px 14px 32px",
  } as const,
  container: {
    width: "100%",
    maxWidth: "460px",
    margin: "0 auto",
  } as const,
  hero: {
    position: "relative",
    overflow: "hidden",
    background:
      "linear-gradient(135deg, rgba(255,255,255,0.94) 0%, rgba(236,255,249,0.96) 50%, rgba(245,239,255,0.96) 100%)",
    borderRadius: "28px",
    padding: "28px 20px 24px",
    border: "1px solid rgba(196, 228, 234, 0.85)",
    boxShadow: "0 16px 36px rgba(148, 185, 193, 0.16)",
  } as const,
  card: {
    background: "rgba(255,255,255,0.88)",
    borderRadius: "24px",
    padding: "16px",
    border: "1px solid rgba(198, 227, 233, 0.85)",
    boxShadow: "0 10px 28px rgba(160, 193, 201, 0.12)",
    marginTop: "14px",
    backdropFilter: "blur(12px)",
  } as const,
  input: {
    width: "100%",
    padding: "14px 14px",
    borderRadius: "16px",
    border: "1px solid #d4e8ed",
    background: "#ffffff",
    color: "#27444d",
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
    borderRadius: "14px",
    border: "none",
    fontSize: "14px",
    fontWeight: 800,
    cursor: "pointer",
  } as const,
  statCard: {
    background: "linear-gradient(180deg, #ffffff 0%, #f5fbff 100%)",
    borderRadius: "20px",
    padding: "16px",
    border: "1px solid rgba(205, 229, 236, 0.9)",
  } as const,
};

function useSubmissionData() {
  const [submissions, setSubmissions] = useState<Submission[]>([]);

  useEffect(() => {
    const q = query(collection(db, "submissions"), orderBy("submittedAt", "asc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      })) as Submission[];

      setSubmissions(items);
    });

    return () => unsubscribe();
  }, []);

  return submissions;
}

function StudentPage() {
  const submissions = useSubmissionData();

  const [name, setName] = useState("");
  const [className, setClassName] = useState("");
  const [bulbCount, setBulbCount] = useState(1);
  const [bulbType, setBulbType] = useState<BulbType>("LED");
  const [error, setError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [mySubmission, setMySubmission] = useState<Submission | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);

  const preview = useMemo(() => calculateResult(bulbCount, bulbType), [bulbCount, bulbType]);

  useEffect(() => {
    const saved = localStorage.getItem(LAST_SUBMISSION_STORAGE_KEY);
    if (saved) {
      try {
        setMySubmission(JSON.parse(saved));
      } catch {
        localStorage.removeItem(LAST_SUBMISSION_STORAGE_KEY);
      }
    }
  }, []);

  const hasDuplicateSubmission = (selectedClass: string, selectedName: string) => {
    const normalizedTarget = normalizeName(selectedName);
    return submissions.some(
      (item) => item.className === selectedClass && normalizeName(item.name) === normalizedTarget,
    );
  };

  useEffect(() => {
    if (!name.trim() || !className) {
      setDuplicateWarning("");
      return;
    }

    if (hasDuplicateSubmission(className, name)) {
      setDuplicateWarning("같은 이름과 학급으로 이미 제출된 기록이 있어요. 다시 확인해 주세요.");
    } else {
      setDuplicateWarning("");
    }
  }, [name, className, submissions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const normalizedName = normalizeName(name);
    const alreadySubmittedOnDevice = localStorage.getItem(DEVICE_SUBMITTED_STORAGE_KEY) === "true";

    if (!normalizedName) {
      setError("이름을 입력해 주세요.");
      return;
    }

    if (!className) {
      setError("학급을 선택해 주세요.");
      return;
    }

    if (bulbCount < 1 || bulbCount > MAX_BULB_COUNT) {
      setError(`전등 개수는 1개 이상 ${MAX_BULB_COUNT}개 이하로 입력해 주세요.`);
      return;
    }

    if (alreadySubmittedOnDevice) {
      setError("이 기기에서는 이미 제출이 완료되었어요.");
      return;
    }

    if (hasDuplicateSubmission(className, normalizedName)) {
      setError("같은 이름과 학급으로 이미 제출된 기록이 있어요.");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const result = calculateResult(bulbCount, bulbType);
      const docId = getSubmissionDocId(className, normalizedName);
      const docRef = doc(db, "submissions", docId);
      const existing = await getDoc(docRef);

      if (existing.exists()) {
        throw new Error("duplicate-submission");
      }

      const submissionData = {
        name: normalizedName,
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

      await setDoc(docRef, submissionData);

      const savedSubmission: Submission = {
        id: docId,
        ...submissionData,
      };

      setMySubmission(savedSubmission);
      setShowResultModal(true);

      localStorage.setItem(LAST_SUBMISSION_STORAGE_KEY, JSON.stringify(savedSubmission));
      localStorage.setItem(DEVICE_SUBMITTED_STORAGE_KEY, "true");

      setName("");
      setClassName("");
      setBulbCount(1);
      setBulbType("LED");
      setDuplicateWarning("");
    } catch (err) {
      console.error("제출 저장 실패:", err);
      if (err instanceof Error && err.message === "duplicate-submission") {
        setError("이미 같은 이름과 학급으로 제출된 기록이 있어요.");
      } else {
        setError("제출 중 오류가 발생했어요. 다시 시도해 주세요.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const totalPeople = submissions.length;
  const totalBulbs = submissions.reduce((sum, s) => sum + s.bulbCount, 0);
  const totalKwh = submissions.reduce((sum, s) => sum + s.savedKwh, 0);
  const totalCo2 = submissions.reduce((sum, s) => sum + s.savedCo2Kg, 0);

  const participantPercent = clamp((totalPeople / EVENT_TARGET_STUDENTS) * 100, 0, 100);
  const powerPercent = clamp((totalKwh / POWER_TARGET_KWH) * 100, 0, 100);
  const carbonPercent = clamp((totalCo2 / CO2_TARGET_KG) * 100, 0, 100);

  const participantColor = getGaugeColor(participantPercent);
  const powerColor = getGaugeColor(powerPercent);
  const carbonColor = getGaugeColor(carbonPercent);

  const alreadySubmittedOnDevice = localStorage.getItem(DEVICE_SUBMITTED_STORAGE_KEY) === "true";
  const canSubmit = !isSubmitting && !alreadySubmittedOnDevice;
  const currentBulbInfo = bulbConfig[bulbType];

  const gaugeBar = (percent: number, color: string) => ({
    width: `${percent}%`,
    height: "100%",
    borderRadius: "999px",
    background: `linear-gradient(90deg, ${color} 0%, ${color}cc 100%)`,
    transition: "width 0.4s ease",
  });

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.hero}>
          <div
            style={{
              position: "absolute",
              top: "-26px",
              right: "-12px",
              width: "112px",
              height: "112px",
              borderRadius: "999px",
              background: "rgba(194, 175, 255, 0.18)",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: "-18px",
              left: "-18px",
              width: "86px",
              height: "86px",
              borderRadius: "999px",
              background: "rgba(124, 226, 200, 0.16)",
            }}
          />

          <div
            style={{
              fontSize: "13px",
              fontWeight: 800,
              color: "#6d8d96",
              marginBottom: "10px",
              position: "relative",
              zIndex: 1,
            }}
          >
            🌍 Earth Day Campaign
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: "28px",
              lineHeight: 1.24,
              fontWeight: 900,
              color: "#24454d",
              position: "relative",
              zIndex: 1,
            }}
          >
            남창고 지구의 날
            <br />
            10분 소등 캠페인
          </h1>

          <p
            style={{
              marginTop: "12px",
              marginBottom: 0,
              color: "#5f7a82",
              lineHeight: 1.65,
              fontSize: "15px",
              position: "relative",
              zIndex: 1,
            }}
          >
            10분 동안 전등을 끄고, 절감된 에너지와 탄소를 확인해 보세요.
          </p>
        </div>

        <div style={styles.card}>
          <h2
            style={{
              marginTop: 0,
              marginBottom: "8px",
              fontSize: "24px",
              fontWeight: 900,
              color: "#24454d",
            }}
          >
            불 끄기 인증하기
          </h2>

          <div style={{ color: "#6b858d", fontSize: "14px", lineHeight: 1.6 }}>
            이름과 학급, 전등 개수를 입력해 주세요.
          </div>

          <form onSubmit={handleSubmit}>
            <div style={{ marginTop: "14px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: 700, fontSize: "15px" }}>
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

            <div style={{ marginTop: "14px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: 700, fontSize: "15px" }}>
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

            <div style={{ marginTop: "14px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: 700, fontSize: "15px" }}>
                끈 전등 개수
              </label>

              <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setBulbCount((prev) => clamp(prev - 1, 1, MAX_BULB_COUNT))}
                  style={{
                    ...styles.smallButton,
                    width: "50px",
                    height: "50px",
                    background: "#e8f7f3",
                    color: "#2c7364",
                    border: "1px solid #ccebe3",
                    fontSize: "24px",
                  }}
                >
                  -
                </button>

                <input
                  type="number"
                  min={1}
                  max={MAX_BULB_COUNT}
                  value={bulbCount}
                  disabled={isSubmitting}
                  onChange={(e) => setBulbCount(clamp(Number(e.target.value) || 1, 1, MAX_BULB_COUNT))}
                  style={{
                    ...styles.input,
                    width: "126px",
                    textAlign: "center" as const,
                    fontWeight: 800,
                    padding: "12px",
                  }}
                />

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setBulbCount((prev) => clamp(prev + 1, 1, MAX_BULB_COUNT))}
                  style={{
                    ...styles.smallButton,
                    width: "50px",
                    height: "50px",
                    background: "#e8f7f3",
                    color: "#2c7364",
                    border: "1px solid #ccebe3",
                    fontSize: "24px",
                  }}
                >
                  +
                </button>
              </div>

              <div style={{ marginTop: "8px", fontSize: "13px", color: "#789098" }}>
                1개 이상 {MAX_BULB_COUNT}개 이하로 입력해 주세요.
              </div>
            </div>

            <div style={{ marginTop: "14px" }}>
              <label style={{ display: "block", marginBottom: "6px", fontWeight: 700, fontSize: "15px" }}>
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
                        padding: "13px 14px",
                        background: active
                          ? "linear-gradient(90deg, #ddfff4 0%, #eef8ff 100%)"
                          : "#ffffff",
                        color: "#29444d",
                        border: active ? "2px solid #8ad9c7" : "1px solid #d8ebef",
                      }}
                    >
                      {bulbConfig[type].emoji} {bulbConfig[type].label} ({bulbConfig[type].watt}W)
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                marginTop: "16px",
                background: "linear-gradient(135deg, #f5fffb 0%, #f5fbff 54%, #fbf7ff 100%)",
                padding: "16px",
                borderRadius: "20px",
                border: "1px solid rgba(198, 227, 233, 0.9)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                <div style={{ fontSize: "15px", fontWeight: 800, color: "#29444d" }}>
                  예상 절감 효과
                </div>
                <div style={{ fontSize: "12px", color: "#6f8891" }}>
                  {currentBulbInfo.emoji} {currentBulbInfo.label}
                </div>
              </div>

              <div style={{ marginTop: "10px", display: "grid", gap: "10px" }}>
                <div style={styles.statCard}>
                  <div style={{ color: "#6c8790", fontSize: "12px" }}>⚡ 절감 전력량</div>
                  <div style={{ marginTop: "6px", fontSize: "22px", fontWeight: 900, color: "#26464d" }}>
                    {formatKwh(preview.savedKwh)} kWh
                  </div>
                </div>

                <div style={styles.statCard}>
                  <div style={{ color: "#6c8790", fontSize: "12px" }}>🌿 탄소 저감</div>
                  <div style={{ marginTop: "6px", fontSize: "22px", fontWeight: 900, color: "#26464d" }}>
                    {formatCo2(preview.savedCo2Kg)} kg
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: "12px",
                background: "#f8fcff",
                color: "#6b828a",
                padding: "12px",
                borderRadius: "14px",
                fontSize: "13px",
                lineHeight: 1.7,
                border: "1px solid #e2edf1",
              }}
            >
              ※ 한 사람당 한 번만 참여해 주세요.
              <br />
              ※ LED 10W, 형광등 20W, 모름 15W 기준
              <br />
              ※ 탄소배출계수 0.424kg/kWh 기준
            </div>

            {alreadySubmittedOnDevice && (
              <div
                style={{
                  marginTop: "12px",
                  background: "#edf8ff",
                  color: "#507b89",
                  padding: "12px",
                  borderRadius: "14px",
                  fontSize: "14px",
                  lineHeight: 1.5,
                  border: "1px solid #d9eaf4",
                }}
              >
                이 기기에서는 이미 제출이 완료되었어요.
              </div>
            )}

            {duplicateWarning && (
              <div
                style={{
                  marginTop: "12px",
                  background: "#fff8ea",
                  color: "#97762d",
                  padding: "12px",
                  borderRadius: "14px",
                  fontSize: "14px",
                  lineHeight: 1.5,
                  border: "1px solid #f0e2b8",
                }}
              >
                ⚠ {duplicateWarning}
              </div>
            )}

            {error && (
              <div
                style={{
                  marginTop: "12px",
                  background: "#fff1f2",
                  color: "#be5b69",
                  padding: "12px",
                  borderRadius: "14px",
                  fontSize: "14px",
                  lineHeight: 1.5,
                  border: "1px solid #f5d2d8",
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                ...styles.button,
                marginTop: "18px",
                background: "linear-gradient(90deg, #8be3cf 0%, #a6d6ff 52%, #c8b5ff 100%)",
                color: "#24454d",
                opacity: canSubmit ? 1 : 0.65,
                cursor: canSubmit ? "pointer" : "not-allowed",
                boxShadow: "0 12px 24px rgba(167, 201, 255, 0.22)",
              }}
            >
              {isSubmitting ? "제출 중..." : "불 끄기 인증 제출"}
            </button>
          </form>
        </div>

        <div style={styles.card}>
          <h2
            style={{
              marginTop: 0,
              marginBottom: "12px",
              fontSize: "24px",
              fontWeight: 900,
              color: "#24454d",
            }}
          >
            실시간 절감 효과
          </h2>

          <div style={{ display: "grid", gap: "12px" }}>
            <div style={styles.statCard}>
              <div style={{ fontSize: "13px", color: "#6c8790" }}>👥 참여 인원</div>
              <div style={{ marginTop: "8px", fontSize: "34px", fontWeight: 900, color: "#24454d" }}>
                {totalPeople}명
              </div>

              <div
                style={{
                  marginTop: "12px",
                  height: "10px",
                  borderRadius: "999px",
                  background: "#edf5f7",
                  overflow: "hidden",
                }}
              >
                <div style={gaugeBar(participantPercent, participantColor)} />
              </div>

              <div style={{ marginTop: "8px", fontSize: "13px", color: "#6c8790" }}>
                목표 대비 {participantPercent.toFixed(1)}%
              </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
              <div style={styles.statCard}>
                <div style={{ color: "#6c8790", fontSize: "12px" }}>⚡ 누적 절감 전력</div>
                <div style={{ marginTop: "6px", fontSize: "24px", fontWeight: 900, color: "#24454d" }}>
                  {totalKwh.toFixed(2)}
                </div>
                <div style={{ color: "#7b949c", fontSize: "13px" }}>kWh</div>

                <div
                  style={{
                    marginTop: "10px",
                    height: "8px",
                    borderRadius: "999px",
                    background: "#edf5f7",
                    overflow: "hidden",
                  }}
                >
                  <div style={gaugeBar(powerPercent, powerColor)} />
                </div>
              </div>

              <div style={styles.statCard}>
                <div style={{ color: "#6c8790", fontSize: "12px" }}>🌿 누적 탄소 저감</div>
                <div style={{ marginTop: "6px", fontSize: "24px", fontWeight: 900, color: "#24454d" }}>
                  {totalCo2.toFixed(2)}
                </div>
                <div style={{ color: "#7b949c", fontSize: "13px" }}>kg CO₂</div>

                <div
                  style={{
                    marginTop: "10px",
                    height: "8px",
                    borderRadius: "999px",
                    background: "#edf5f7",
                    overflow: "hidden",
                  }}
                >
                  <div style={gaugeBar(carbonPercent, carbonColor)} />
                </div>
              </div>
            </div>

            <div style={styles.statCard}>
              <div style={{ color: "#6c8790", fontSize: "12px" }}>💡 끈 전등 수</div>
              <div style={{ marginTop: "6px", fontSize: "24px", fontWeight: 900, color: "#24454d" }}>
                {totalBulbs}개
              </div>
            </div>
          </div>
        </div>
      </div>

      {showResultModal && mySubmission && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(92, 112, 120, 0.28)",
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
              maxWidth: "360px",
              background: "linear-gradient(180deg, #ffffff 0%, #f8fffd 56%, #faf7ff 100%)",
              borderRadius: "24px",
              padding: "24px 20px",
              boxShadow: "0 18px 42px rgba(132, 168, 180, 0.22)",
              border: "1px solid rgba(205, 229, 236, 0.95)",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "32px", marginBottom: "8px" }}>✅</div>
            <h3
              style={{
                marginTop: 0,
                marginBottom: "10px",
                fontSize: "24px",
                fontWeight: 900,
                color: "#24454d",
              }}
            >
              인증 완료!
            </h3>

            <div style={{ fontSize: "17px", fontWeight: 800, color: "#365862" }}>
              {mySubmission.name} · {mySubmission.className}
            </div>

            <div
              style={{
                marginTop: "10px",
                color: "#678089",
                fontSize: "15px",
                lineHeight: 1.6,
              }}
            >
              전등 {mySubmission.bulbCount}개를 끄고 참여했어요.
            </div>

            <div style={{ marginTop: "16px", display: "grid", gap: "10px" }}>
              <div style={styles.statCard}>
                <div style={{ color: "#6c8790", fontSize: "12px" }}>⚡ 절감 전력량</div>
                <div style={{ marginTop: "6px", fontSize: "22px", fontWeight: 900, color: "#24454d" }}>
                  {formatKwh(mySubmission.savedKwh)} kWh
                </div>
              </div>

              <div style={styles.statCard}>
                <div style={{ color: "#6c8790", fontSize: "12px" }}>🌿 탄소 저감</div>
                <div style={{ marginTop: "6px", fontSize: "22px", fontWeight: 900, color: "#24454d" }}>
                  {formatCo2(mySubmission.savedCo2Kg)} kg
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowResultModal(false)}
              style={{
                ...styles.button,
                marginTop: "16px",
                background: "linear-gradient(90deg, #8be3cf 0%, #a6d6ff 52%, #c8b5ff 100%)",
                color: "#24454d",
              }}
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminPage() {
  const submissions = useSubmissionData();

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");

  const totalPeople = submissions.length;
  const totalBulbs = submissions.reduce((sum, s) => sum + s.bulbCount, 0);
  const totalKwh = submissions.reduce((sum, s) => sum + s.savedKwh, 0);
  const totalCo2 = submissions.reduce((sum, s) => sum + s.savedCo2Kg, 0);

  const classSummary = useMemo(() => {
    const summaryMap = new Map<
      string,
      { className: string; people: number; bulbs: number; kwh: number; co2: number }
    >();

    for (const item of submissions) {
      const current = summaryMap.get(item.className) ?? {
        className: item.className,
        people: 0,
        bulbs: 0,
        kwh: 0,
        co2: 0,
      };

      current.people += 1;
      current.bulbs += item.bulbCount;
      current.kwh += item.savedKwh;
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

  const handleUnlock = () => {
    if (!ADMIN_PASSWORD) {
      setPasswordError("관리자 비밀번호가 설정되지 않았습니다. .env 파일을 확인해 주세요.");
      return;
    }

    if (password === ADMIN_PASSWORD) {
      setIsUnlocked(true);
      setPasswordError("");
    } else {
      setPasswordError("비밀번호가 올바르지 않습니다.");
    }
  };

  if (!isUnlocked) {
    return (
      <div style={styles.page}>
        <div style={styles.container}>
          <div style={styles.card}>
            <h2 style={{ marginTop: 0, marginBottom: "8px", fontSize: "24px", fontWeight: 900 }}>
              관리자 화면
            </h2>

            <p style={{ color: "#67818a", lineHeight: 1.6, fontSize: "14px" }}>
              관리자 전용 페이지입니다. 비밀번호를 입력하세요.
            </p>

            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUnlock();
              }}
              style={styles.input}
              placeholder="비밀번호 입력"
            />

            {passwordError && (
              <div
                style={{
                  marginTop: "12px",
                  background: "#fff1f2",
                  color: "#be5b69",
                  padding: "12px",
                  borderRadius: "14px",
                  fontSize: "14px",
                  border: "1px solid #f5d2d8",
                }}
              >
                {passwordError}
              </div>
            )}

            <button
              onClick={handleUnlock}
              style={{
                ...styles.button,
                marginTop: "16px",
                background: "linear-gradient(90deg, #8be3cf 0%, #a6d6ff 52%, #c8b5ff 100%)",
                color: "#24454d",
              }}
            >
              확인
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page}>
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
            <div>
              <h2 style={{ marginTop: 0, marginBottom: "8px", fontSize: "22px" }}>관리자 요약 화면</h2>
              <p style={{ margin: 0, color: "#67818a", fontSize: "14px", lineHeight: 1.5 }}>
                제출 데이터는 실시간으로 반영됩니다.
              </p>
            </div>

            <button
              onClick={() => setIsUnlocked(false)}
              style={{
                ...styles.smallButton,
                background: "#eef7ff",
                color: "#4e7180",
                minWidth: "92px",
                border: "1px solid #d6e7f2",
              }}
            >
              잠금
            </button>
          </div>
        </div>

        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
            <h3 style={{ margin: 0 }}>전체 통계</h3>
            <button
              onClick={() => downloadCsv(submissions)}
              style={{
                ...styles.smallButton,
                background: "linear-gradient(90deg, #8be3cf 0%, #a6d6ff 52%, #c8b5ff 100%)",
                color: "#24454d",
              }}
            >
              CSV 다운로드
            </button>
          </div>

          <div style={{ display: "grid", gap: "10px" }}>
            <div style={styles.statCard}>
              <div style={{ color: "#6c8790", fontSize: "13px" }}>총 참여 인원</div>
              <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{totalPeople}</div>
            </div>

            <div style={styles.statCard}>
              <div style={{ color: "#6c8790", fontSize: "13px" }}>총 전등 수</div>
              <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{totalBulbs}</div>
            </div>

            <div style={styles.statCard}>
              <div style={{ color: "#6c8790", fontSize: "13px" }}>총 절감 전력</div>
              <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{formatKwh(totalKwh)} kWh</div>
            </div>

            <div style={styles.statCard}>
              <div style={{ color: "#6c8790", fontSize: "13px" }}>총 탄소 저감</div>
              <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{formatCo2(totalCo2)} kg</div>
            </div>
          </div>
        </div>

        <div style={styles.card}>
          <h3 style={{ marginTop: 0, marginBottom: "12px" }}>학급별 순위</h3>

          {classSummary.length === 0 ? (
            <p style={{ color: "#67818a", margin: 0 }}>아직 제출된 데이터가 없습니다.</p>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {classSummary.map((item, index) => (
                <div key={item.className} style={styles.statCard}>
                  <div style={{ color: "#6c8790", fontSize: "13px" }}>{index + 1}위</div>
                  <div style={{ marginTop: "4px", fontSize: "22px", fontWeight: 900 }}>{item.className}</div>
                  <div style={{ marginTop: "8px", color: "#59757f", lineHeight: 1.7, fontSize: "14px" }}>
                    <div>👥 참여 인원: {item.people}명</div>
                    <div>💡 전등 수: {item.bulbs}개</div>
                    <div>⚡ 절감 전력: {formatKwh(item.kwh)} kWh</div>
                    <div>🌿 탄소 저감: {formatCo2(item.co2)} kg</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={styles.card}>
          <h3 style={{ marginTop: 0, marginBottom: "12px" }}>최근 제출 20건</h3>
          <p style={{ marginTop: 0, color: "#6c838a", fontSize: "13px", lineHeight: 1.6 }}>
            공개 화면 노출을 고려해 이름은 일부만 표시합니다.
          </p>

          {recentSubmissions.length === 0 ? (
            <p style={{ color: "#67818a", margin: 0 }}>아직 제출된 데이터가 없습니다.</p>
          ) : (
            <div style={{ display: "grid", gap: "10px" }}>
              {recentSubmissions.map((item) => (
                <div key={item.id} style={styles.statCard}>
                  <div style={{ fontSize: "18px", fontWeight: 800 }}>{getMaskedName(item.name)}</div>
                  <div style={{ marginTop: "6px", color: "#59757f", fontSize: "14px", lineHeight: 1.7 }}>
                    <div>학급: {item.className}</div>
                    <div>전등 수: {item.bulbCount}개</div>
                    <div>제출 시각: {formatDateTime(item.submittedAt)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<StudentPage />} />
      <Route path="/admin-asdfqwer" element={<AdminPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}