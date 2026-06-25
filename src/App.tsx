import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ubgnefwrdmrrmdueczmd.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZ25lZndyZG1ycm1kdWVjem1kIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzEzNzksImV4cCI6MjA5NzkwNzM3OX0.W0JoyacMOAZyk4eil1cROPSQGBcxoHT9Ir_DQNuw6FA";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const ACCENT = "#7C6EF7";
const ACCENT_SOFT = "#EEE9FF";
const BG = "#0F0F13";
const SURFACE = "#1A1A22";
const SURFACE2 = "#23232F";
const TEXT = "#F0EEF8";
const TEXT_MUTED = "#8885A0";
const BORDER = "#2E2E3E";

const DEFAULT_CATEGORIES = ["Work", "Ideas", "Personal", "Health", "Random"];

async function callClaude(messages: any[], systemPrompt: string) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 1000,
      system: systemPrompt,
      messages,
    }),
  });
  const data = await response.json();
  return data.content?.map((b: any) => b.text || "").join("") || "";
}

function formatTime(ts: number | string) {
  const d = typeof ts === "string" ? new Date(ts) : new Date(Number(ts));
  if (isNaN(d.getTime())) return "Just now";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function PulsingDot() {
  return (
    <span style={{
      display: "inline-block", width: 10, height: 10,
      borderRadius: "50%", background: "#F87171",
      animation: "pulse 1s ease-in-out infinite",
      boxShadow: "0 0 0 0 rgba(248,113,113,0.4)"
    }} />
  );
}

export default function ThoughtStream() {
  const [tab, setTab] = useState("record");
  const [notes, setNotes] = useState<any[]>([]);
  const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [inputMode, setInputMode] = useState<"voice" | "text">("voice");
  const [manualText, setManualText] = useState("");
  const [selectedCat, setSelectedCat] = useState("");
  const [customCat, setCustomCat] = useState("");
  const [aiCatSuggestion, setAiCatSuggestion] = useState<string | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [synthFilter, setSynthFilter] = useState<string | null>(null);
  const [synthResult, setSynthResult] = useState<Record<string, string>>({});
  const [synthLoading, setSynthLoading] = useState(false);
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [recorderError, setRecorderError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    loadNotes();
  }, []);

  const loadNotes = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("notes")
        .select("*")
        .order("ts", { ascending: false });

      if (error) {
        setDbError("Could not connect to database: " + error.message);
      } else {
        setNotes(data || []);
        const noteCats = (data || []).map((n: any) => n.category).filter(Boolean);
        const allCats = [...new Set([...DEFAULT_CATEGORIES, ...noteCats])] as string[];
        setCategories(allCats);
      }
    } catch (e: any) {
      setDbError("Connection error: " + e.message);
    }
    setLoading(false);
  };

  const startRecording = () => {
    setRecorderError(null);
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setRecorderError("Speech recognition isn't supported in this browser. Try Chrome or Edge.");
      return;
    }
    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    let final = "";
    rec.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + " ";
        else interim += e.results[i][0].transcript;
      }
      setTranscript(final + interim);
    };
    rec.onerror = (e: any) => {
      setRecorderError("Mic error: " + e.error);
      setRecording(false);
    };
    rec.start();
    recognitionRef.current = rec;
    setRecording(true);
  };

  const stopRecording = () => {
    recognitionRef.current?.stop();
    setRecording(false);
  };

  const suggestCategory = async (text: string) => {
    if (!text.trim()) return;
    const result = await callClaude(
      [{ role: "user", content: `Text: "${text}"\n\nExisting categories: ${categories.join(", ")}\n\nReturn ONLY a category name — either one from the list or a new short one (1-2 words). No explanation.` }],
      "You are a categorization assistant for someone with ADHD. Pick the most fitting category for their thought."
    );
    setAiCatSuggestion(result.trim().replace(/[^a-zA-Z0-9 ]/g, ""));
  };

  const activeText = inputMode === "voice" ? transcript : manualText;

  const saveNote = async () => {
    const text = activeText.trim();
    if (!text) return;
    setSavingNote(true);

    let cat = customCat.trim() || selectedCat;
    if (!cat && aiCatSuggestion) cat = aiCatSuggestion;
    if (!cat) cat = "Random";

    const ts = Date.now();

    const { data, error } = await supabase
      .from("notes")
      .insert([{ text, category: cat, ts }])
      .select()
      .single();

    if (error) {
      setDbError("Failed to save note: " + error.message);
    } else {
      setNotes(prev => [data, ...prev]);
      if (!categories.includes(cat)) {
        setCategories(prev => [...prev, cat]);
      }
      setTranscript("");
      setManualText("");
      setSelectedCat("");
      setCustomCat("");
      setAiCatSuggestion(null);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    }

    setSavingNote(false);
  };

  const deleteNote = async (id: number) => {
    const { error } = await supabase.from("notes").delete().eq("id", id);
    if (!error) {
      setNotes(notes.filter(n => n.id !== id));
    }
  };

  const synthesize = async (cat: string | null) => {
    setSynthFilter(cat);
    setSynthLoading(true);
    const relevant = notes.filter(n => !cat || n.category === cat);
    if (!relevant.length) { setSynthLoading(false); return; }

    const formatted = relevant.map((n, i) => `${i + 1}. [${n.category}] ${n.text}`).join("\n");
    const result = await callClaude(
      [{ role: "user", content: `Here are my voice notes:\n\n${formatted}\n\nPlease synthesize these into clear insights, patterns, and actionable takeaways. Group related thoughts. Be concise but thorough.` }],
      "You are a thoughtful assistant helping someone with ADHD make sense of their scattered thoughts. Identify themes, surface key insights, and suggest concrete next steps where relevant. Use plain language. Format with short headers and bullet points."
    );
    setSynthResult(prev => ({ ...prev, [cat || "__all__"]: result }));
    setSynthLoading(false);
  };

  const usedCategories = [...new Set(notes.map(n => n.category))];

  const filteredNotes = notes.filter(n => {
    const matchesCat = !filterCat || n.category === filterCat;
    const matchesSearch = !searchQuery || n.text.toLowerCase().includes(searchQuery.toLowerCase()) || n.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCat && matchesSearch;
  });

  const s: Record<string, any> = {
    app: { fontFamily: "'Inter', system-ui, sans-serif", background: BG, minHeight: "100vh", color: TEXT, display: "flex", flexDirection: "column", maxWidth: 640, margin: "0 auto", padding: "0 0 80px" },
    header: { padding: "24px 20px 0", borderBottom: `1px solid ${BORDER}` },
    title: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px", color: TEXT, margin: 0 },
    subtitle: { fontSize: 13, color: TEXT_MUTED, margin: "4px 0 16px" },
    tabs: { display: "flex", gap: 0 },
    tab: (active: boolean) => ({ flex: 1, padding: "10px 0", fontSize: 13, fontWeight: 500, background: "none", border: "none", borderBottom: active ? `2px solid ${ACCENT}` : "2px solid transparent", color: active ? ACCENT : TEXT_MUTED, cursor: "pointer", transition: "all 0.15s" }),
    body: { padding: "20px" },
    card: { background: SURFACE, borderRadius: 14, padding: 20, marginBottom: 16, border: `1px solid ${BORDER}` },
    recordBtn: (active: boolean) => ({
      width: 72, height: 72, borderRadius: "50%", border: "none", cursor: "pointer",
      background: active ? "#F87171" : ACCENT,
      boxShadow: active ? "0 0 0 8px rgba(248,113,113,0.15)" : "0 0 0 8px rgba(124,110,247,0.15)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: 28, transition: "all 0.2s", margin: "0 auto"
    }),
    transcript: { background: SURFACE2, borderRadius: 10, padding: 14, minHeight: 80, fontSize: 14, lineHeight: 1.6, color: transcript ? TEXT : TEXT_MUTED, marginTop: 16, border: `1px solid ${BORDER}`, whiteSpace: "pre-wrap" as const },
    label: { fontSize: 12, fontWeight: 600, color: TEXT_MUTED, textTransform: "uppercase" as const, letterSpacing: 0.8, marginBottom: 8, display: "block" },
    catChips: { display: "flex", flexWrap: "wrap" as const, gap: 8 },
    chip: (active: boolean) => ({ padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 500, cursor: "pointer", border: `1px solid ${active ? ACCENT : BORDER}`, background: active ? ACCENT_SOFT : "transparent", color: active ? ACCENT : TEXT_MUTED, transition: "all 0.15s" }),
    input: { width: "100%", background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px", fontSize: 14, color: TEXT, outline: "none", boxSizing: "border-box" as const },
    textarea: { width: "100%", background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px", fontSize: 14, color: TEXT, outline: "none", boxSizing: "border-box" as const, minHeight: 100, resize: "vertical" as const, fontFamily: "inherit", lineHeight: 1.6 },
    btn: (variant = "primary") => ({
      padding: "10px 20px", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 600, fontSize: 14,
      background: variant === "primary" ? ACCENT : SURFACE2,
      color: variant === "primary" ? "#fff" : TEXT_MUTED,
      transition: "opacity 0.15s"
    }),
    modeBtn: (active: boolean) => ({ flex: 1, padding: "8px 0", fontSize: 13, fontWeight: 500, background: active ? ACCENT : "transparent", color: active ? "#fff" : TEXT_MUTED, border: `1px solid ${active ? ACCENT : BORDER}`, cursor: "pointer", transition: "all 0.15s" }),
    noteCard: { background: SURFACE, borderRadius: 12, padding: 16, marginBottom: 10, border: `1px solid ${BORDER}` },
    catBadge: (cat: string) => {
      const colors: Record<string, string> = { Work: "#60A5FA", Ideas: "#34D399", Personal: "#F9A8D4", Health: "#A3E635", Random: "#FCD34D" };
      const c = colors[cat] || ACCENT;
      return { display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: c + "22", color: c, marginBottom: 8 };
    },
    synthCard: { background: SURFACE, borderRadius: 14, padding: 20, marginBottom: 12, border: `1px solid ${BORDER}` },
    synthOutput: { background: SURFACE2, borderRadius: 10, padding: 14, fontSize: 14, lineHeight: 1.7, color: TEXT, marginTop: 12, border: `1px solid ${BORDER}`, whiteSpace: "pre-wrap" as const },
    searchBox: { width: "100%", background: SURFACE2, border: `1px solid ${BORDER}`, borderRadius: 10, padding: "10px 14px 10px 38px", fontSize: 14, color: TEXT, outline: "none", boxSizing: "border-box" as const },
  };

  return (
    <div style={s.app}>
      <style>{`
        @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(248,113,113,0.4)} 50%{box-shadow:0 0 0 8px rgba(248,113,113,0)} }
        @keyframes fadein { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }
        * { box-sizing: border-box; }
        ::-webkit-scrollbar { width: 4px; } ::-webkit-scrollbar-track { background: transparent; } ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        textarea::placeholder { color: ${TEXT_MUTED}; }
        input::placeholder { color: ${TEXT_MUTED}; }
      `}</style>

      <div style={s.header}>
        <h1 style={s.title}>ThoughtStream</h1>
        <p style={s.subtitle}>Capture thoughts. Let AI connect the dots.</p>
        <div style={s.tabs}>
          {[["record","🎙 Record"],["notes","📝 Notes"],["synthesis","✨ Synthesis"]].map(([id,label]) => (
            <button key={id} style={s.tab(tab===id)} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>
      </div>

      <div style={s.body}>

        {dbError && (
          <div style={{ background: "#F8717122", border: "1px solid #F87171", borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 13, color: "#F87171" }}>
            ⚠️ {dbError}
          </div>
        )}

        {/* RECORD TAB */}
        {tab === "record" && (
          <div style={{ animation: "fadein 0.2s ease" }}>

            {/* Mode toggle */}
            <div style={{ display: "flex", gap: 0, marginBottom: 16, borderRadius: 10, overflow: "hidden", border: `1px solid ${BORDER}` }}>
              <button style={{ ...s.modeBtn(inputMode === "voice"), borderRadius: "9px 0 0 9px", borderRight: "none" }} onClick={() => setInputMode("voice")}>🎙 Voice</button>
              <button style={{ ...s.modeBtn(inputMode === "text"), borderRadius: "0 9px 9px 0", borderLeft: "none" }} onClick={() => setInputMode("text")}>⌨️ Type</button>
            </div>

            {/* Voice mode */}
            {inputMode === "voice" && (
              <div style={s.card}>
                <div style={{ textAlign: "center", marginBottom: 8 }}>
                  <p style={{ color: TEXT_MUTED, fontSize: 13, margin: "0 0 16px" }}>
                    {recording ? <><PulsingDot /> &nbsp;Listening...</> : "Tap to start recording"}
                  </p>
                  <button style={s.recordBtn(recording)} onClick={recording ? stopRecording : startRecording}>
                    {recording ? "⏹" : "🎙"}
                  </button>
                </div>
                {recorderError && <p style={{ color: "#F87171", fontSize: 13, marginTop: 12, textAlign: "center" }}>{recorderError}</p>}
                <div style={s.transcript}>{transcript || "Your words will appear here..."}</div>
              </div>
            )}

            {/* Text mode */}
            {inputMode === "text" && (
              <div style={s.card}>
                <span style={s.label}>Type your thought</span>
                <textarea
                  style={s.textarea}
                  placeholder="What's on your mind..."
                  value={manualText}
                  onChange={e => setManualText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveNote(); }}
                />
                <p style={{ fontSize: 11, color: TEXT_MUTED, margin: "6px 0 0" }}>Tip: Ctrl+Enter to save quickly</p>
              </div>
            )}

            {/* Category + save — show when there's text */}
            {activeText.trim() && (
              <div style={{ ...s.card, animation: "fadein 0.2s ease" }}>
                <div style={{ marginBottom: 16 }}>
                  <span style={s.label}>Category</span>
                  <div style={s.catChips}>
                    {categories.map(c => (
                      <button key={c} style={s.chip(selectedCat === c)} onClick={() => { setSelectedCat(c); setCustomCat(""); }}>{c}</button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 16 }}>
                  <span style={s.label}>Or add a new category</span>
                  <input style={s.input} placeholder="e.g. Travel, Finance..." value={customCat} onChange={e => { setCustomCat(e.target.value); setSelectedCat(""); }} />
                </div>

                {aiCatSuggestion && (
                  <div style={{ marginBottom: 16, padding: "10px 14px", background: ACCENT_SOFT, borderRadius: 10, fontSize: 13, color: ACCENT, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>✨ AI suggests: <strong>{aiCatSuggestion}</strong></span>
                    <button style={{ background: ACCENT, color: "#fff", border: "none", borderRadius: 6, padding: "4px 10px", fontSize: 12, cursor: "pointer" }} onClick={() => { setSelectedCat(aiCatSuggestion!); setCustomCat(""); }}>Use it</button>
                  </div>
                )}

                <div style={{ display: "flex", gap: 10 }}>
                  <button style={s.btn("secondary")} onClick={() => suggestCategory(activeText)}>✨ Suggest category</button>
                  <button style={{ ...s.btn("primary"), opacity: savingNote ? 0.6 : 1 }} onClick={saveNote} disabled={savingNote}>
                    {savingNote ? "Saving..." : justSaved ? "✓ Saved!" : "Save note"}
                  </button>
                </div>
              </div>
            )}

            {justSaved && !activeText.trim() && (
              <div style={{ textAlign: "center", color: "#34D399", fontSize: 14, padding: 12 }}>✓ Saved to your database! Capture another.</div>
            )}
          </div>
        )}

        {/* NOTES TAB */}
        {tab === "notes" && (
          <div style={{ animation: "fadein 0.2s ease" }}>

            {/* Search bar */}
            <div style={{ position: "relative", marginBottom: 16 }}>
              <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 16, color: TEXT_MUTED, pointerEvents: "none" }}>🔍</span>
              <input
                style={s.searchBox}
                placeholder="Search your notes..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery("")} style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: TEXT_MUTED, cursor: "pointer", fontSize: 16 }}>×</button>
              )}
            </div>

            {/* Category filters */}
            <div style={{ marginBottom: 16 }}>
              <div style={s.catChips}>
                <button style={s.chip(!filterCat)} onClick={() => setFilterCat(null)}>All ({notes.length})</button>
                {usedCategories.map(c => (
                  <button key={c} style={s.chip(filterCat === c)} onClick={() => setFilterCat(c)}>{c} ({notes.filter(n=>n.category===c).length})</button>
                ))}
              </div>
            </div>

            {loading && <div style={{ textAlign: "center", color: TEXT_MUTED, padding: "40px 0" }}>Loading your notes...</div>}

            {!loading && filteredNotes.length === 0 && (
              <div style={{ textAlign: "center", color: TEXT_MUTED, padding: "40px 0", fontSize: 14 }}>
                {searchQuery ? `No notes matching "${searchQuery}"` : "No notes yet. Hit the mic and capture something!"}
              </div>
            )}

            {searchQuery && filteredNotes.length > 0 && (
              <p style={{ fontSize: 12, color: TEXT_MUTED, marginBottom: 12 }}>{filteredNotes.length} result{filteredNotes.length !== 1 ? "s" : ""} for "{searchQuery}"</p>
            )}

            {filteredNotes.map(note => (
              <div key={note.id} style={{ ...s.noteCard, animation: "fadein 0.2s ease" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <span style={s.catBadge(note.category)}>{note.category}</span>
                  <button onClick={() => deleteNote(note.id)} style={{ background: "none", border: "none", color: TEXT_MUTED, cursor: "pointer", fontSize: 16, padding: 0, lineHeight: 1 }}>×</button>
                </div>
                <p style={{ margin: "4px 0 8px", fontSize: 14, lineHeight: 1.6 }}>
                  {searchQuery ? highlightMatch(note.text, searchQuery) : note.text}
                </p>
                <span style={{ fontSize: 11, color: TEXT_MUTED }}>{formatTime(note.ts)}</span>
              </div>
            ))}
          </div>
        )}

        {/* SYNTHESIS TAB */}
        {tab === "synthesis" && (
          <div style={{ animation: "fadein 0.2s ease" }}>
            <p style={{ color: TEXT_MUTED, fontSize: 13, marginBottom: 20 }}>
              AI compiles and connects your notes into clear insights. Pick a category or synthesize everything at once.
            </p>

            {notes.length === 0 && (
              <div style={{ textAlign: "center", color: TEXT_MUTED, padding: "40px 0", fontSize: 14 }}>
                Record some notes first, then come back here to see the magic.
              </div>
            )}

            {notes.length > 0 && (
              <>
                <div style={s.synthCard}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Everything</p>
                      <p style={{ margin: "2px 0 0", fontSize: 12, color: TEXT_MUTED }}>{notes.length} notes across all categories</p>
                    </div>
                    <button style={s.btn("primary")} onClick={() => synthesize(null)} disabled={synthLoading && synthFilter === null}>
                      {synthLoading && synthFilter === null ? "Thinking..." : "Synthesize"}
                    </button>
                  </div>
                  {synthResult["__all__"] && (
                    <div style={s.synthOutput}>{synthResult["__all__"]}</div>
                  )}
                </div>

                {usedCategories.map(cat => (
                  <div key={cat} style={s.synthCard}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <div>
                        <span style={s.catBadge(cat)}>{cat}</span>
                        <p style={{ margin: "4px 0 0", fontSize: 12, color: TEXT_MUTED }}>{notes.filter(n=>n.category===cat).length} notes</p>
                      </div>
                      <button style={s.btn("primary")} onClick={() => synthesize(cat)} disabled={synthLoading && synthFilter === cat}>
                        {synthLoading && synthFilter === cat ? "Thinking..." : "Synthesize"}
                      </button>
                    </div>
                    {synthResult[cat] && (
                      <div style={s.synthOutput}>{synthResult[cat]}</div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function highlightMatch(text: string, query: string) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query})`, "gi"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={i} style={{ background: "#7C6EF744", color: "#A89EF8", borderRadius: 3, padding: "0 2px" }}>{part}</mark>
      : part
  );
}
