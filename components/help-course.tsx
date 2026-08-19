"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Download, GraduationCap, Lightbulb, ListChecks, Search, ShieldCheck, X } from "lucide-react";

type Tone = "rule" | "attention" | "tip" | "conclusion";
type Section = { title: string; paragraphs?: string[]; items?: string[]; steps?: string[]; table?: { headers: string[]; rows: string[][] }; callout?: { tone: Tone; title: string; text: string }; checklist?: string[]; activity?: { items: string[]; criterion: string }; flow?: string[] };
type Chapter = { number: number; title: string; subtitle: string; audience: string; sections: Section[] };
type HelpCourseProps = { chapters: Chapter[]; userId: number; profileLabel: string; canDownloadFullManual: boolean };

const calloutMeta: Record<Tone, { label: string; icon: typeof CircleAlert }> = {
  rule: { label: "Regra", icon: ShieldCheck },
  attention: { label: "Atenção", icon: CircleAlert },
  tip: { label: "Dica", icon: Lightbulb },
  conclusion: { label: "Conclusão", icon: CheckCircle2 },
};

function SectionBlock({ section }: { section: Section }) {
  return <section className="help-section">
    <h3>{section.title}</h3>
    {section.flow && <div className="help-flow">{section.flow.map((item, index) => <div key={item}><span>{item}</span>{index < section.flow!.length - 1 && <ChevronRight size={16} />}</div>)}</div>}
    {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
    {section.steps && <div className="help-steps">{section.steps.map((step, index) => { const [title, ...rest] = step.split(" — "); return <div className="help-step" key={step}><span>{index + 1}</span><div><strong>{title}</strong>{rest.length > 0 && <p>{rest.join(" — ")}</p>}</div></div>; })}</div>}
    {section.items && <ul className="help-list">{section.items.map((item) => <li key={item}>{item}</li>)}</ul>}
    {section.table && <div className="help-table-wrap"><table><thead><tr>{section.table.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{section.table.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={`${index}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>}
    {section.checklist && <div className="help-checklist"><div className="help-checklist-title"><ListChecks size={17} />{section.title}</div>{section.checklist.map((item) => <div className="help-check-row" key={item}><span /><p>{item}</p></div>)}</div>}
    {section.callout && <Callout {...section.callout} />}
    {section.activity && <div className="help-activity"><strong>{section.title}</strong><ul>{section.activity.items.map((item) => <li key={item}>{item}</li>)}</ul><p><b>Critério de conclusão:</b> {section.activity.criterion}</p></div>}
  </section>;
}

function Callout({ tone, title, text }: { tone: Tone; title: string; text: string }) {
  const meta = calloutMeta[tone];
  const Icon = meta.icon;
  return <div className={`help-callout help-callout-${tone}`}><div className="help-callout-label"><Icon size={17} />{meta.label}</div><div><strong>{title}</strong><p>{text}</p></div></div>;
}

export function HelpCourse({ chapters, userId, profileLabel, canDownloadFullManual }: HelpCourseProps) {
  const firstNumber = chapters[0]?.number ?? 1;
  const [selected, setSelected] = useState(firstNumber);
  const [query, setQuery] = useState("");
  const [completed, setCompleted] = useState<number[]>([]);
  const [mobileIndex, setMobileIndex] = useState(false);
  const storageKey = `pub-help-completed-v2-${userId}`;
  const availableNumbers = useMemo(() => new Set(chapters.map((chapter) => chapter.number)), [chapters]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
      if (Array.isArray(saved)) setCompleted(saved.filter((value) => Number.isInteger(value) && availableNumbers.has(value)));
    } catch {}
  }, [storageKey, availableNumbers]);

  useEffect(() => {
    if (!availableNumbers.has(selected)) setSelected(firstNumber);
  }, [availableNumbers, firstNumber, selected]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("pt-BR");
    if (!normalized) return chapters;
    return chapters.filter((chapter) => JSON.stringify(chapter).toLocaleLowerCase("pt-BR").includes(normalized));
  }, [chapters, query]);

  const chapterIndex = Math.max(0, chapters.findIndex((item) => item.number === selected));
  const chapter = chapters[chapterIndex] ?? chapters[0];
  const completedVisible = completed.filter((number) => availableNumbers.has(number));
  const progress = chapters.length ? Math.round((completedVisible.length / chapters.length) * 100) : 0;

  function choose(number: number) {
    if (!availableNumbers.has(number)) return;
    setSelected(number);
    setMobileIndex(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleComplete() {
    if (!chapter) return;
    const next = completedVisible.includes(chapter.number)
      ? completedVisible.filter((number) => number !== chapter.number)
      : [...completedVisible, chapter.number].sort((a, b) => a - b);
    setCompleted(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  }

  if (!chapter) return null;

  return <div className="help-page">
    <div className="help-hero"><div><span className="eyebrow">Guia oficial de treinamento</span><h2>Curso e Manual Operacional</h2><p>Trilha personalizada para <strong>{profileLabel}</strong>. O conteúdo abaixo acompanha as permissões liberadas para o seu usuário.</p></div><div className="help-hero-actions"><button className="btn btn-light help-index-button" type="button" onClick={() => setMobileIndex(true)}><BookOpen size={17} /> Sumário</button>{canDownloadFullManual && <a className="btn btn-primary" href="/manual-operacional.pdf" download><Download size={17} /> Baixar PDF completo</a>}</div></div>
    <div className="help-progress-card"><div><GraduationCap size={20} /><span><strong>{completedVisible.length} de {chapters.length}</strong> capítulos da sua trilha marcados como concluídos</span></div><div className="help-progress-track"><span style={{ width: `${progress}%` }} /></div><b>{progress}%</b></div>
    <div className="help-layout">
      <aside className={`help-index ${mobileIndex ? "open" : ""}`}><div className="help-index-head"><div><span className="eyebrow">Sumário</span><strong>{chapters.length} capítulos liberados</strong></div><button type="button" aria-label="Fechar sumário" onClick={() => setMobileIndex(false)}><X size={20} /></button></div><label className="help-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar na sua trilha..." /></label><nav>{filtered.map((item) => <button type="button" key={item.number} onClick={() => choose(item.number)} className={`${selected === item.number ? "active" : ""} ${completedVisible.includes(item.number) ? "complete" : ""}`}><span>{completedVisible.includes(item.number) ? <Check size={13} /> : item.number}</span><div><strong>{item.title}</strong><small>Capítulo {item.number}</small></div></button>)}</nav>{filtered.length === 0 && <div className="help-no-results">Nenhum capítulo encontrado na sua trilha.</div>}</aside>
      {mobileIndex && <button className="help-index-backdrop" type="button" aria-label="Fechar sumário" onClick={() => setMobileIndex(false)} />}
      <article className="help-content"><div className="help-chapter-head"><div><span className="help-chapter-number">{String(chapter.number).padStart(2, "0")}</span><span className="eyebrow">Capítulo {chapterIndex + 1} de {chapters.length} da sua trilha</span><h1>{chapter.title}</h1><p>{chapter.subtitle}</p></div><button type="button" className={`help-complete-button ${completedVisible.includes(chapter.number) ? "complete" : ""}`} onClick={toggleComplete}>{completedVisible.includes(chapter.number) ? <CheckCircle2 size={18} /> : <span />}{completedVisible.includes(chapter.number) ? "Concluído" : "Marcar como concluído"}</button></div><div className="help-audience"><ShieldCheck size={18} /><div><strong>Quem deve estudar</strong><p>{chapter.audience}</p></div></div>{chapter.sections.map((section, index) => <SectionBlock section={section} key={`${chapter.number}-${index}`} />)}
        <div className="help-chapter-nav"><button className="btn btn-light" disabled={chapterIndex === 0} onClick={() => choose(chapters[chapterIndex - 1]?.number)}><ChevronLeft size={17} /> Anterior</button><span>{chapterIndex + 1} de {chapters.length} capítulos liberados</span><button className="btn btn-primary" disabled={chapterIndex === chapters.length - 1} onClick={() => choose(chapters[chapterIndex + 1]?.number)}>Próximo <ChevronRight size={17} /></button></div>
      </article>
    </div>
  </div>;
}
