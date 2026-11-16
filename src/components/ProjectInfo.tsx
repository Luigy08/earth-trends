import { Alert, Link } from '@mui/material';
import { ArrowOutward } from '@mui/icons-material';
import { HIDDEN_WORKFLOWS } from '../app.constant';
import { ABOUT_CHALLENGE, ABOUT_INTRO, ABOUT_REFERENCES, ABOUT_SECTION_ID, ABOUT_SOURCES_NOTE, ABOUT_WORKFLOWS, CHALLENGE_QUESTIONS, CHALLENGE_URL, INVESTIGATION_EXAMPLE, INVESTIGATION_NOTE, INVESTIGATION_STEPS, METHOD_FACTS, METHOD_NOTES } from '../about.constant';
import { useScrollReveal } from '../animation/useScrollReveal';
import { SectionHeading } from './SectionHeading';

/** Project description for visitors: the challenge, how to investigate, the workflows and the method. */
export function ProjectInfo() {
  // A hidden query mode is not described, nor is its source listed, until it is offered again.
  const workflows = ABOUT_WORKFLOWS.filter(item => !HIDDEN_WORKFLOWS.includes(item.workflow));
  const references = ABOUT_REFERENCES.filter(item => !item.workflow || !HIDDEN_WORKFLOWS.includes(item.workflow));
  const container = useScrollReveal<HTMLElement>();
  return <section ref={container} className="project-info" id={ABOUT_SECTION_ID} aria-label="About the project">
    <div className="project-block">
      <div data-reveal><SectionHeading eyebrow="ABOUT THE PROJECT" title="From a question to evidence." /></div>
      <p data-reveal className="project-lead">{ABOUT_INTRO}</p>
      <p data-reveal className="project-lead">The project addresses the NASA Space Apps Challenge <Link href={CHALLENGE_URL} target="_blank" rel="noopener noreferrer">Be An Earth System Trend Detective!</Link>: {ABOUT_CHALLENGE}</p>
      <div className="project-grid">{CHALLENGE_QUESTIONS.map((item, index) => <article data-reveal className="project-card" key={item.question}><span>{String(index + 1).padStart(2, '0')} / QUESTION</span><h3>{item.question}</h3><p>{item.answer}</p></article>)}</div>
    </div>
    <div className="project-block">
      <div data-reveal><SectionHeading eyebrow="HOW TO INVESTIGATE" title="Five steps, one confirmation." /></div>
      <ol className="project-steps">{INVESTIGATION_STEPS.map(step => <li data-reveal key={step.title}><h3>{step.title}</h3><p>{step.description}</p></li>)}</ol>
      <blockquote data-reveal className="project-example"><span className="eyebrow">TRY ASKING</span><p>“{INVESTIGATION_EXAMPLE}”</p><small>{INVESTIGATION_NOTE}</small></blockquote>
    </div>
    <div className="project-block">
      <div data-reveal><SectionHeading eyebrow="WORKFLOWS AND DATA" title="Separate paths, traceable sources." /></div>
      <div className="project-grid">{workflows.map(item => <article data-reveal className="project-card" key={item.workflow}><h3>{item.title}</h3><p>{item.description}</p></article>)}</div>
      <Alert data-reveal severity="info" className="project-alert">{ABOUT_SOURCES_NOTE}</Alert>
    </div>
    <div className="project-block">
      <div data-reveal><SectionHeading eyebrow="HOW TREND ANALYSIS WORKS" title="Coverage first, then the trend." /></div>
      <div className="project-facts">{METHOD_FACTS.map(fact => <div data-reveal key={fact.value}><strong>{fact.value}</strong><span>{fact.label}</span></div>)}</div>
      {METHOD_NOTES.map(note => <p data-reveal className="project-lead" key={note}>{note}</p>)}
    </div>
    <div className="project-block">
      <div data-reveal><SectionHeading eyebrow="REFERENCES" title="Sources and further reading." /></div>
      <ul data-reveal className="project-references">{references.map(item => <li key={item.href}><Link href={item.href} target="_blank" rel="noopener noreferrer">{item.label}<ArrowOutward fontSize="inherit" /></Link></li>)}</ul>
    </div>
  </section>;
}
