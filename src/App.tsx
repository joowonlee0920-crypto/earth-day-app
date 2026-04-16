import { useEffect, useMemo, useRef, useState } from "react";
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

const SCHOOL_TOTAL_STUDENTS = 1000;
const EVENT_TARGET_STUDENTS = 300;
const POWER_TARGET_KWH = 2.5;
const CO2_TARGET_KG = 1.0;

const EVENT_START_HOUR = 20;
const EVENT_START_MINUTE = 0;
const EVENT_END_HOUR = 20;
const EVENT_END_MINUTE = 10;

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
  UNKNOWN: { label: "모르겠음", watt: 15, emoji: "❓" },
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
  if (percent < 35) return "#52d98c";
  if (percent < 70) return "#f3cc56";
  return "#ff8b66";
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

function makeIcons(emoji: string, count: number) {
  return Array.from({ length: count }, (_, i) => (
    <span key={`${emoji}-${i}`} style={{ fontSize: "18px", lineHeight: 1 }}>
      {emoji}
    </span>
  ));
}

function getSubmissionDocId(className: string, name: string) {
  return `${className}-${normalizeName(name)}`;
}

function isEventOpen(now: Date) {
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const startMinutes = EVENT_START_HOUR * 60 + EVENT_START_MINUTE;
  const endMinutes = EVENT_END_HOUR * 60 + EVENT_END_MINUTE;
  return currentMinutes >= startMinutes && currentMinutes < endMinutes;
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
    "절약 전기요금(원)",
    "탄소 저감(kg)",
    "제출 시각",
  ];

  const rows = submissions.map((item) => [
    item.name,
    item.className,
    item.bulbCount,
    bulbConfig[item.bulbType].label,
    item.savedKwh.toFixed(3),
    Math.round(item.savedCostWon),
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
  link.click();
  URL.revokeObjectURL(url);
}

const styles = {
  page: {
    minHeight: "100vh",
    background:
      "radial-gradient(circle at top, rgba(80,180,120,0.18) 0%, rgba(10,20,18,0) 34%), linear-gradient(180deg, #07130f 0%, #0d231b 45%, #143527 100%)",
    color: "#f4fff8",
    fontFamily: "Pretendard, system-ui, sans-serif",
    padding: "14px",
  } as const,
  container: {
    width: "100%",
    maxWidth: "460px",
    margin: "0 auto",
    paddingBottom: "44px",
  } as const,
  hero: {
    background: "linear-gradient(135deg, rgba(19,96,57,0.95) 0%, rgba(34,152,95,0.95) 55%, rgba(74,205,126,0.95) 100%)",
    borderRadius: "28px",
    padding: "24px 18px 20px",
    boxShadow: "0 22px 38px rgba(0,0,0,0.26)",
    border: "1px solid rgba(255,255,255,0.14)",
    overflow: "hidden",
    position: "relative",
  } as const,
  card: {
    background: "rgba(10, 26, 20, 0.92)",
    borderRadius: "24px",
    padding: "18px",
    border: "1px solid rgba(255,255,255,0.07)",
    boxShadow: "0 12px 24px rgba(0,0,0,0.16)",
    marginTop: "14px",
    backdropFilter: "blur(10px)",
  } as const,
  input: {
    width: "100%",
    padding: "14px 14px",
    borderRadius: "15px",
    border: "1px solid #3f735c",
    background: "#143126",
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
    background: "linear-gradient(180deg, rgba(19,54,40,0.95) 0%, rgba(15,43,32,0.95) 100%)",
    borderRadius: "20px",
    padding: "16px",
    border: "1px solid rgba(126,240,168,0.10)",
  } as const,
};

export default function App() {
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
  const [mySubmission, setMySubmission] = useState<Submission | null>(null);

  const [isAdminUnlocked, setIsAdminUnlocked] = useState(false);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const [adminPasswordError, setAdminPasswordError] = useState("");
  const [titleTapCount, setTitleTapCount] = useState(0);

  const [now, setNow] = useState(new Date());
  const resultCardRef = useRef<HTMLDivElement | null>(null);

  const preview = useMemo(() => calculateResult(bulbCount, bulbType), [bulbCount, bulbType]);

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

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date());
    }, 1000);

    return () => clearInterval(timer);
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
    const isLive = isEventOpen(now);
    const alreadySubmittedOnDevice = localStorage.getItem(DEVICE_SUBMITTED_STORAGE_KEY) === "true";

    if (!isLive) {
      setError("지금은 제출 시간이 아닙니다. 행사 시간(20:00~20:10)에만 제출할 수 있어요.");
      setSuccessMessage("");
      return;
    }

    if (!normalizedName) {
      setError("이름을 입력해 주세요.");
      setSuccessMessage("");
      return;
    }

    if (!className) {
      setError("학급을 선택해 주세요.");
      setSuccessMessage("");
      return;
    }

    if (bulbCount < 1 || bulbCount > MAX_BULB_COUNT) {
      setError(`전등 개수는 1개 이상 ${MAX_BULB_COUNT}개 이하로 입력해 주세요.`);
      setSuccessMessage("");
      return;
    }

    if (alreadySubmittedOnDevice) {
      setError("이 기기에서는 이미 제출했어요. 한 사람당 한 번만 참여해 주세요.");
      setSuccessMessage("");
      return;
    }

    if (hasDuplicateSubmission(className, normalizedName)) {
      setError("같은 이름과 학급으로 이미 제출된 기록이 있어요.");
      setSuccessMessage("");
      return;
    }

    setError("");
    setSuccessMessage("");
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
      localStorage.setItem(LAST_SUBMISSION_STORAGE_KEY, JSON.stringify(savedSubmission));
      localStorage.setItem(DEVICE_SUBMITTED_STORAGE_KEY, "true");

      setSuccessMessage("인증이 완료되었어요. 아래 나의 결과 카드에서 확인해 보세요.");
      setName("");
      setClassName("");
      setBulbCount(1);
      setBulbType("LED");
      setDuplicateWarning("");

      setTimeout(() => {
        resultCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 150);
    } catch (err) {
      console.error("제출 저장 실패:", err);
      if (err instanceof Error && err.message === "duplicate-submission") {
        setError("이미 같은 이름과 학급으로 제출된 기록이 있어요.");
      } else {
        setError("제출 중 오류가 발생했어요. 다시 시도해 주세요.");
      }
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

  const participantPercent = clamp((totalPeople / EVENT_TARGET_STUDENTS) * 100, 0, 100);
  const powerPercent = clamp((totalKwh / POWER_TARGET_KWH) * 100, 0, 100);
  const carbonPercent = clamp((totalCo2 / CO2_TARGET_KG) * 100, 0, 100);

  const participantColor = getGaugeColor(participantPercent);
  const powerColor = getGaugeColor(powerPercent);
  const carbonColor = getGaugeColor(carbonPercent);

  const powerIcons = clamp(Math.max(Math.round((totalKwh / POWER_TARGET_KWH) * 8), totalKwh > 0 ? 1 : 0), 0, 8);
  const carbonIcons = clamp(Math.max(Math.round((totalCo2 / CO2_TARGET_KG) * 8), totalCo2 > 0 ? 1 : 0), 0, 8);

  const classSummary = useMemo(() => {
    const summaryMap = new Map<
      string,
      { className: string; people: number; bulbs: number; kwh: number; won: number; co2: number }
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
  const isEventLive = isEventOpen(now);
  const alreadySubmittedOnDevice = localStorage.getItem(DEVICE_SUBMITTED_STORAGE_KEY) === "true";
  const canSubmit = isEventLive && !isSubmitting && !alreadySubmittedOnDevice;

  const openAdminPage = () => {
    if (!ADMIN_PASSWORD) {
      setAdminPasswordInput("");
      setAdminPasswordError("관리자 비밀번호가 설정되지 않았습니다. .env 파일을 확인해 주세요.");
      setShowAdminModal(true);
      return;
    }

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

  const handleCopyShareText = async () => {
    if (!mySubmission) return;

    const text = `나는 지구의 날 소등 행사에서 전등 ${mySubmission.bulbCount}개를 끄고 약 ${formatKwh(
      mySubmission.savedKwh,
    )}kWh의 전력을 절약했어요. 탄소는 약 ${formatCo2(mySubmission.savedCo2Kg)}kg 줄였어요!`;

    try {
      await navigator.clipboard.writeText(text);
      alert("공유 문구가 복사되었어요.");
    } catch {
      alert("복사에 실패했어요. 다시 시도해 주세요.");
    }
  };

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
          <div
            style={{
              position: "absolute",
              right: "-26px",
              top: "-26px",
              width: "120px",
              height: "120px",
              borderRadius: "999px",
              background: "rgba(255,255,255,0.10)",
            }}
          />
          <div style={{ fontSize: "13px", opacity: 0.95, marginBottom: "8px", fontWeight: 700 }}>🌍 Earth Day Campaign</div>

          <h1
            onClick={handleTitleTap}
            style={{
              margin: 0,
              fontSize: "30px",
              lineHeight: 1.2,
              fontWeight: 900,
              cursor: "pointer",
              userSelect: "none",
              position: "relative",
              zIndex: 1,
            }}
          >
            남창고 지구의 날
            <br />
            불 끄기 실천
          </h1>

          <p
            style={{
              marginTop: "12px",
              marginBottom: 0,
              color: "#effff4",
              lineHeight: 1.65,
              fontSize: "15px",
              position: "relative",
              zIndex: 1,
            }}
          >
            10분 동안 불을 끄고, 우리 학교의 실천을 함께 기록해요.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginTop: "16px", position: "relative", zIndex: 1 }}>
            <div
              style={{
                background: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: "18px",
                padding: "12px",
              }}
            >
              <div style={{ fontSize: "12px", opacity: 0.9 }}>행사 시간</div>
              <div style={{ marginTop: "4px", fontSize: "18px", fontWeight: 900 }}>20:00~20:10</div>
            </div>
            <div
              style={{
                background: "rgba(255,255,255,0.14)",
                border: "1px solid rgba(255,255,255,0.18)",
                borderRadius: "18px",
                padding: "12px",
              }}
            >
              <div style={{ fontSize: "12px", opacity: 0.9 }}>참여 방법</div>
              <div style={{ marginTop: "4px", fontSize: "18px", fontWeight: 900 }}>이름·학급 입력</div>
            </div>
          </div>

          {isEventLive ? (
            <div
              style={{
                marginTop: "14px",
                background: "rgba(255,255,255,0.18)",
                border: "1px solid rgba(255,255,255,0.24)",
                borderRadius: "16px",
                padding: "10px 12px",
                fontWeight: 800,
                fontSize: "15px",
                position: "relative",
                zIndex: 1,
              }}
            >
              🔴 지금 참여할 수 있어요
            </div>
          ) : (
            <div
              style={{
                marginTop: "14px",
                background: "rgba(255,255,255,0.12)",
                border: "1px solid rgba(255,255,255,0.16)",
                borderRadius: "16px",
                padding: "10px 12px",
                fontWeight: 700,
                fontSize: "14px",
                position: "relative",
                zIndex: 1,
              }}
            >
              ⏰ 제출은 행사 시간에만 가능해요
            </div>
          )}
        </div>

        {page === "student" ? (
          <>
            <div style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: "12px" }}>
                <div>
                  <h2 style={{ marginTop: 0, marginBottom: "6px", fontSize: "24px", fontWeight: 900, color: "#ffffff" }}>
                    실시간 참여 현황
                  </h2>
                  <div style={{ color: "#d7f7e2", fontSize: "14px" }}>학교 전체 실천이 실시간으로 쌓이고 있어요</div>
                </div>
                <div
                  style={{
                    background: "rgba(82,217,140,0.12)",
                    color: "#b9ffd2",
                    border: "1px solid rgba(82,217,140,0.18)",
                    borderRadius: "999px",
                    padding: "6px 10px",
                    fontSize: "12px",
                    fontWeight: 800,
                    whiteSpace: "nowrap",
                  }}
                >
                  목표 {EVENT_TARGET_STUDENTS}명
                </div>
              </div>

              <div style={{ marginTop: "16px", display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: "12px" }}>
                <div style={styles.statCard}>
                  <div style={{ fontSize: "44px", fontWeight: 900, lineHeight: 1 }}>{animatedPeople}</div>
                  <div style={{ marginTop: "6px", fontSize: "17px", fontWeight: 800 }}>명 참여</div>
                  <div
                    style={{
                      marginTop: "12px",
                      height: "10px",
                      borderRadius: "999px",
                      background: "#28473a",
                      overflow: "hidden",
                    }}
                  >
                    <div style={gaugeBar(participantPercent, participantColor)} />
                  </div>
                  <div style={{ marginTop: "8px", color: "#d7f7e2", fontSize: "13px", lineHeight: 1.6 }}>
                    목표 대비 {participantPercent.toFixed(1)}%
                  </div>
                </div>

                <div style={{ display: "grid", gap: "10px" }}>
                  <div style={styles.statCard}>
                    <div style={{ color: "#baf3cf", fontSize: "12px" }}>⚡ 절감 전력</div>
                    <div style={{ marginTop: "6px", fontSize: "24px", fontWeight: 900 }}>{animatedKwh.toFixed(2)}</div>
                    <div style={{ color: "#dbffea", fontSize: "13px" }}>kWh</div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={{ color: "#baf3cf", fontSize: "12px" }}>🌿 탄소 저감</div>
                    <div style={{ marginTop: "6px", fontSize: "24px", fontWeight: 900 }}>{animatedCo2.toFixed(2)}</div>
                    <div style={{ color: "#dbffea", fontSize: "13px" }}>kg CO₂</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={styles.card}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px" }}>
                <div>
                  <h2 style={{ marginTop: 0, marginBottom: "6px", fontSize: "24px", fontWeight: 900, color: "#ffffff" }}>
                    불 끄기 인증
                  </h2>
                  <div style={{ color: "#d7f7e2", fontSize: "14px", lineHeight: 1.6 }}>
                    이름과 학급만 입력하면 참여할 수 있어요
                  </div>
                </div>
                <div
                  style={{
                    minWidth: "72px",
                    textAlign: "center",
                    background: "rgba(255,255,255,0.05)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "16px",
                    padding: "10px 8px",
                  }}
                >
                  <div style={{ fontSize: "11px", color: "#b8f5ca" }}>한 사람</div>
                  <div style={{ marginTop: "2px", fontSize: "16px", fontWeight: 900 }}>1회</div>
                </div>
              </div>

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
                      onClick={() => setBulbCount((prev) => clamp(prev - 1, 1, MAX_BULB_COUNT))}
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
                      max={MAX_BULB_COUNT}
                      value={bulbCount}
                      disabled={isSubmitting}
                      onChange={(e) => setBulbCount(clamp(Number(e.target.value) || 1, 1, MAX_BULB_COUNT))}
                      style={{
                        ...styles.input,
                        width: "118px",
                        textAlign: "center" as const,
                        padding: "12px",
                      }}
                    />
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setBulbCount((prev) => clamp(prev + 1, 1, MAX_BULB_COUNT))}
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
                  <div style={{ marginTop: "8px", fontSize: "13px", color: "#b8f5ca" }}>
                    1개 이상 {MAX_BULB_COUNT}개 이하로 입력해 주세요.
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
                    borderRadius: "20px",
                    border: "1px solid rgba(126,240,168,0.22)",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center" }}>
                    <div style={{ fontSize: "15px", fontWeight: 800 }}>미리 계산 결과</div>
                    <div style={{ fontSize: "12px", color: "#b8f5ca" }}>{currentBulbInfo.emoji} {currentBulbInfo.label}</div>
                  </div>
                  <div style={{ marginTop: "10px", display: "grid", gap: "10px" }}>
                    <div style={styles.statCard}>
                      <div style={{ color: "#baf3cf", fontSize: "12px" }}>⚡ 절감 전력량</div>
                      <div style={{ marginTop: "6px", fontSize: "22px", fontWeight: 900 }}>{formatKwh(preview.savedKwh)} kWh</div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div style={styles.statCard}>
                        <div style={{ color: "#baf3cf", fontSize: "12px" }}>💰 전기요금</div>
                        <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 900 }}>{formatWon(preview.savedCostWon)}원</div>
                      </div>
                      <div style={styles.statCard}>
                        <div style={{ color: "#baf3cf", fontSize: "12px" }}>🌿 탄소 저감</div>
                        <div style={{ marginTop: "6px", fontSize: "20px", fontWeight: 900 }}>{formatCo2(preview.savedCo2Kg)}kg</div>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "12px",
                    background: "rgba(126,240,168,0.08)",
                    color: "#d7f7e2",
                    padding: "12px",
                    borderRadius: "14px",
                    fontSize: "13px",
                    lineHeight: 1.7,
                  }}
                >
                  ※ 한 사람당 한 번만 참여해 주세요.
                  <br />
                  ※ LED 10W, 형광등 20W, 모름 15W 기준
                  <br />
                  ※ 전기요금 200원/kWh, 탄소배출계수 0.424kg/kWh 기준
                </div>

                {alreadySubmittedOnDevice && (
                  <div
                    style={{
                      marginTop: "12px",
                      background: "rgba(82, 217, 140, 0.10)",
                      color: "#baffd5",
                      padding: "12px",
                      borderRadius: "14px",
                      fontSize: "14px",
                      lineHeight: 1.5,
                    }}
                  >
                    이 기기에서는 이미 제출이 완료되었어요.
                  </div>
                )}

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
                  disabled={!canSubmit}
                  style={{
                    ...styles.button,
                    marginTop: "18px",
                    background: "linear-gradient(90deg, #1ea95f 0%, #41d67a 100%)",
                    color: "#08311f",
                    opacity: canSubmit ? 1 : 0.65,
                    cursor: canSubmit ? "pointer" : "not-allowed",
                    boxShadow: "0 14px 24px rgba(30,169,95,0.20)",
                  }}
                >
                  {isSubmitting ? "제출 중..." : isEventLive ? "불 끄기 인증 제출" : "행사 시간에 제출 가능"}
                </button>
              </form>
            </div>

            <div style={styles.card}>
              <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "24px", fontWeight: 900, color: "#ffffff" }}>
                실시간 절감 효과
              </h2>

              <div style={{ display: "grid", gap: "12px" }}>
                <div style={styles.statCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                    <div>
                      <div style={{ color: "#baf3cf", fontSize: "13px" }}>⚡ 누적 절감 전력</div>
                      <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{animatedKwh.toFixed(2)} kWh</div>
                    </div>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {makeIcons("💡", powerIcons)}
                    </div>
                  </div>
                  <div style={{ marginTop: "10px", height: "10px", borderRadius: "999px", background: "#28473a", overflow: "hidden" }}>
                    <div style={gaugeBar(powerPercent, powerColor)} />
                  </div>
                </div>

                <div style={styles.statCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                    <div>
                      <div style={{ color: "#baf3cf", fontSize: "13px" }}>🌿 누적 탄소 감소</div>
                      <div style={{ marginTop: "6px", fontSize: "28px", fontWeight: 900 }}>{animatedCo2.toFixed(2)} kg CO₂</div>
                    </div>
                    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap", justifyContent: "flex-end" }}>
                      {makeIcons("🌳", carbonIcons)}
                    </div>
                  </div>
                  <div style={{ marginTop: "10px", height: "10px", borderRadius: "999px", background: "#28473a", overflow: "hidden" }}>
                    <div style={gaugeBar(carbonPercent, carbonColor)} />
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div style={styles.statCard}>
                    <div style={{ color: "#baf3cf", fontSize: "13px" }}>💰 누적 절약 요금</div>
                    <div style={{ marginTop: "6px", fontSize: "24px", fontWeight: 900 }}>{formatWon(totalWon)}원</div>
                  </div>
                  <div style={styles.statCard}>
                    <div style={{ color: "#baf3cf", fontSize: "13px" }}>💡 끈 전등 수</div>
                    <div style={{ marginTop: "6px", fontSize: "24px", fontWeight: 900 }}>{totalBulbs}개</div>
                  </div>
                </div>
              </div>
            </div>

            <div style={styles.card} ref={resultCardRef}>
              <h2 style={{ marginTop: 0, marginBottom: "12px", fontSize: "24px", fontWeight: 900, color: "#ffffff" }}>
                나의 결과
              </h2>

              {!mySubmission ? (
                <p style={{ color: "#d7f7e2", margin: 0, lineHeight: 1.6 }}>아직 이 기기에서 제출한 내용이 없어요.</p>
              ) : (
                <>
                  <div
                    style={{
                      background: "linear-gradient(135deg, #123628 0%, #1b4f39 100%)",
                      borderRadius: "20px",
                      padding: "16px",
                      marginBottom: "12px",
                    }}
                  >
                    <div style={{ fontSize: "13px", color: "#baf3cf" }}>참여 정보</div>
                    <div style={{ fontSize: "22px", fontWeight: 900, marginTop: "6px" }}>
                      {mySubmission.name} · {mySubmission.className}
                    </div>
                    <div style={{ marginTop: "8px", color: "#dbffea", fontSize: "15px", lineHeight: 1.5 }}>
                      {bulbConfig[mySubmission.bulbType].emoji} 전등 {mySubmission.bulbCount}개를 {DURATION_MINUTES}분 동안 끔
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: "10px" }}>
                    <div style={styles.statCard}>
                      <div style={{ color: "#baf3cf", fontSize: "13px" }}>⚡ 절감 전력량</div>
                      <div style={{ marginTop: "6px", fontSize: "30px", fontWeight: 900 }}>{formatKwh(mySubmission.savedKwh)}</div>
                      <div style={{ color: "#dbffea" }}>kWh</div>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                      <div style={styles.statCard}>
                        <div style={{ color: "#baf3cf", fontSize: "13px" }}>💰 절약 전기요금</div>
                        <div style={{ marginTop: "6px", fontSize: "22px", fontWeight: 900 }}>{formatWon(mySubmission.savedCostWon)}</div>
                        <div style={{ color: "#dbffea" }}>원</div>
                      </div>

                      <div style={styles.statCard}>
                        <div style={{ color: "#baf3cf", fontSize: "13px" }}>🌿 탄소 저감량</div>
                        <div style={{ marginTop: "6px", fontSize: "22px", fontWeight: 900 }}>{formatCo2(mySubmission.savedCo2Kg)}</div>
                        <div style={{ color: "#dbffea" }}>kg CO₂</div>
                      </div>
                    </div>

                    <div style={styles.statCard}>
                      <div style={{ color: "#baf3cf", fontSize: "13px" }}>🕒 제출 시각</div>
                      <div style={{ marginTop: "6px", fontSize: "16px", fontWeight: 700, lineHeight: 1.5 }}>
                        {formatDateTime(mySubmission.submittedAt)}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={handleCopyShareText}
                    style={{
                      ...styles.button,
                      marginTop: "14px",
                      background: "#275743",
                      color: "#ffffff",
                    }}
                  >
                    결과 문구 복사하기
                  </button>
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
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginBottom: "12px" }}>
                <h3 style={{ margin: 0 }}>전체 통계</h3>
                <button
                  onClick={() => downloadCsv(submissions)}
                  style={{
                    ...styles.smallButton,
                    background: "linear-gradient(90deg, #1ea95f 0%, #41d67a 100%)",
                    color: "#08311f",
                  }}
                >
                  CSV 다운로드
                </button>
              </div>
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
              <h3 style={{ marginTop: 0, marginBottom: "12px" }}>학급별 순위</h3>
              {classSummary.length === 0 ? (
                <p style={{ color: "#d7f7e2", margin: 0 }}>아직 제출된 데이터가 없습니다.</p>
              ) : (
                <div style={{ display: "grid", gap: "10px" }}>
                  {classSummary.map((item, index) => (
                    <div key={item.className} style={styles.statCard}>
                      <div style={{ color: "#baf3cf", fontSize: "13px" }}>{index + 1}위</div>
                      <div style={{ marginTop: "4px", fontSize: "22px", fontWeight: 900 }}>{item.className}</div>
                      <div style={{ marginTop: "8px", color: "#dbffea", lineHeight: 1.7, fontSize: "14px" }}>
                        <div>👥 참여 인원: {item.people}명</div>
                        <div>💡 전등 수: {item.bulbs}개</div>
                        <div>⚡ 절감 전력: {formatKwh(item.kwh)} kWh</div>
                        <div>💰 절약 요금: {formatWon(item.won)}원</div>
                        <div>🌿 탄소 저감: {formatCo2(item.co2)} kg</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={styles.card}>
              <h3 style={{ marginTop: 0, marginBottom: "12px" }}>최근 제출 20건</h3>
              <p style={{ marginTop: 0, color: "#b8f5ca", fontSize: "13px", lineHeight: 1.6 }}>
                공개 화면 노출을 고려해 이름은 일부만 표시합니다.
              </p>
              {recentSubmissions.length === 0 ? (
                <p style={{ color: "#d7f7e2", margin: 0 }}>아직 제출된 데이터가 없습니다.</p>
              ) : (
                <div style={{ display: "grid", gap: "10px" }}>
                  {recentSubmissions.map((item) => (
                    <div key={item.id} style={styles.statCard}>
                      <div style={{ fontSize: "18px", fontWeight: 800 }}>{getMaskedName(item.name)}</div>
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

