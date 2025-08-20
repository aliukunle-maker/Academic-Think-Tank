import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Type } from '@google/genai';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import { TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

// Setup PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.5.136/build/pdf.worker.mjs`;

const thesisReviewOptions = {
  statement_clarity: {
    label: 'Clarity of Thesis Statement',
    prompt: '**Clarity of Thesis Statement:** Assess the clarity and focus of the central research question or thesis statement. Is it well-defined, arguable, and appropriately scoped?',
  },
  intro: {
    label: 'Abstract & Introduction',
    prompt: '**Abstract and Introduction:** Critique the abstract and introduction. Does the abstract accurately summarize the work? Does the introduction effectively grab attention, provide background, and outline the structure?',
  },
  literature: {
    label: 'Depth of Literature',
    prompt: '**Depth of Literature:** Evaluate how well the text is situated within existing research. Are the references relevant and sufficient? Is there a critical engagement with the literature?',
  },
  soundness: {
    label: 'Scientific Soundness',
    prompt: '**Scientific Soundness:** Assess the methodology, arguments, and evidence. Is the reasoning logical? Are claims well-supported? Is the research design appropriate?',
  },
  structure: {
    label: 'Argument Structure & Flow',
    prompt: '**Argument Structure & Flow:** Evaluate the logical flow and coherence of the text. Is the argument easy to follow? Are transitions between sections smooth? Does the narrative build convincingly?',
  },
  contribution: {
    label: 'Contribution to Knowledge',
    prompt: '**Contribution to Knowledge:** Determine the originality and significance of the work. What new insights, methods, or findings does it offer to the field?',
  },
  gaps: {
    label: 'Research Gaps',
    prompt: '**Research Gaps:** Identify any potential gaps in the research or areas for future investigation that the text reveals or fails to address.',
  },
  conclusion: {
    label: 'Conclusion & Future Work',
    prompt: '**Conclusion and Future Work:** Analyze the conclusion. Does it effectively summarize findings? Does it convincingly state the contribution? Are suggestions for future work thoughtful and relevant?',
  },
};

const manuscriptReviewOptions = {
    title_abstract: {
        label: 'Title & Abstract',
        prompt: '**Title & Abstract:** Assess the title\'s impact and the abstract\'s accuracy in summarizing the work for a journal audience.'
    },
    introduction: {
        label: 'Introduction',
        prompt: '**Introduction:** Evaluate if the introduction clearly states the research problem, establishes a gap in current knowledge, and presents a compelling hypothesis or objective.'
    },
    methods: {
        label: 'Methods',
        prompt: '**Methods:** Critique the methodology for clarity, appropriateness, and replicability. Is there enough detail for another researcher to reproduce the experiments?'
    },
    results: {
        label: 'Results',
        prompt: '**Results:** Analyze the presentation of results. Are they clear, logical, and well-supported by data, figures, and tables? Is there any interpretation in the results section?'
    },
    discussion: {
        label: 'Discussion',
        prompt: '**Discussion:** Assess how well the discussion interprets the results, relates them to existing literature, addresses limitations, and articulates the study\'s significance and contribution.'
    },
    impact_novelty: {
        label: 'Impact & Novelty',
        prompt: '**Impact & Novelty:** Determine the originality and potential impact of the work. Does it offer significant new insights that would interest a broad scientific audience?'
    },
    clarity_style: {
        label: 'Clarity & Writing Style',
        prompt: '**Clarity & Writing Style:** Evaluate the manuscript\'s overall readability, conciseness, and adherence to academic writing conventions. Is the language precise and professional?'
    },
    journal_fit: {
        label: 'Journal Fit & Storytelling',
        prompt: '**Journal Fit & Storytelling:** Assess the overall narrative. Does the manuscript tell a coherent and compelling story? Is it suitable for a high-impact journal in its field?'
    }
};


const defaultThesisSections = ['literature', 'soundness', 'contribution', 'gaps'];
const defaultManuscriptSections = ['introduction', 'methods', 'results', 'discussion'];

interface ResearchPlan {
  title: string;
  abstract: string;
  introduction: string;
  researchQuestions: string[];
  methodologyFlowchart: {
    stage: number;
    title: string;
    steps: {
      id: string;
      title: string;
      details: string;
      theorem?: {
        name: string;
        explanation: string;
      };
    }[];
  }[];
  contribution: string;
  limitations: string;
}

interface ChatMessage {
    role: 'user' | 'model';
    text: string;
    quote?: string;
}

const ResearchPlanRenderer = ({ plan }: { plan: ResearchPlan }) => {
  return (
    <div className="research-plan-container">
      <div className="plan-section">
        <h3>Proposed Title</h3>
        <p>{plan.title}</p>
      </div>
      <div className="plan-section">
        <h3>Abstract</h3>
        <p>{plan.abstract}</p>
      </div>
      <div className="plan-section">
        <h3>Introduction / Background</h3>
        <p>{plan.introduction}</p>
      </div>
       <div className="plan-section">
        <h3>Core Research Questions</h3>
        <ul>
            {plan.researchQuestions.map((q, i) => <li key={i}>{q}</li>)}
        </ul>
      </div>
      <div className="plan-section">
        <h3>Methodology Flowchart</h3>
        <div className="flowchart-container">
          {plan.methodologyFlowchart.map((stage, stageIndex) => (
            <React.Fragment key={stage.stage}>
              <div className="flowchart-stage">
                {stage.steps.map(step => (
                  <div key={step.id} className="flowchart-step">
                    <h4>{step.title}</h4>
                    <p>{step.details}</p>
                    {step.theorem && (
                      <div className="theorem-box">
                        <h5>Supporting Principle: {step.theorem.name}</h5>
                        <p>{step.theorem.explanation}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {stageIndex < plan.methodologyFlowchart.length - 1 && (
                <div className="flowchart-connector">↓</div>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="plan-section">
        <h3>Expected Contribution</h3>
        <p>{plan.contribution}</p>
      </div>
      <div className="plan-section">
        <h3>Potential Limitations</h3>
        <p>{plan.limitations}</p>
      </div>
    </div>
  );
};

const PDFViewer = ({ file, highlightText }: { file: File | null, highlightText: string | null }) => {
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [totalPages, setTotalPages] = useState(0);

    useEffect(() => {
        if (!file) {
            setPdfDoc(null);
            setTotalPages(0);
            return;
        }
        const reader = new FileReader();
        reader.onload = async (e) => {
            if (!e.target?.result) return;
            const typedArray = new Uint8Array(e.target.result as ArrayBuffer);
            try {
                const loadingTask = pdfjsLib.getDocument(typedArray);
                const pdf = await loadingTask.promise;
                setPdfDoc(pdf);
                setTotalPages(pdf.numPages);
            } catch (error) {
                console.error("Error loading PDF:", error);
            }
        };
        reader.readAsArrayBuffer(file);
    }, [file]);

    useEffect(() => {
        if (!highlightText || !pdfDoc) return;

        document.querySelectorAll('.highlight').forEach(el => el.classList.remove('highlight'));

        const findAndHighlight = async () => {
             for (let i = 1; i <= totalPages; i++) {
                const page = await pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => 'str' in item ? item.str : '').join('');

                if (pageText.includes(highlightText)) {
                    const pageElement = document.getElementById(`page-${i}`);
                    if (pageElement) {
                        pageElement.scrollIntoView({ behavior: 'smooth', block: 'start' });

                        // Delay highlight to allow for scroll
                        setTimeout(() => {
                            const textLayer = pageElement.querySelector('.textLayer');
                            if (!textLayer) return;
    
                            const spans = Array.from(textLayer.querySelectorAll('span[role="presentation"]'));
                            let textBuffer = '';
                            const bufferSpans: HTMLElement[] = [];
    
                            for (const span of spans) {
                                const htmlSpan = span as HTMLElement;
                                textBuffer += htmlSpan.textContent || '';
                                bufferSpans.push(htmlSpan);
    
                                if (textBuffer.includes(highlightText)) {
                                    const spansToHighlight = [...bufferSpans];
                                    spansToHighlight.forEach(s => s.classList.add('highlight'));
                                    return; // Stop after first highlight
                                }
    
                                // Keep buffer from growing too large
                                while (textBuffer.length > highlightText.length * 2 && bufferSpans.length > 0) {
                                    const removedSpan = bufferSpans.shift();
                                    if(removedSpan?.textContent) {
                                        textBuffer = textBuffer.substring(removedSpan.textContent.length);
                                    }
                                }
                            }
                        }, 300);
                    }
                    break; 
                }
            }
        };
        findAndHighlight();
    }, [highlightText, pdfDoc, totalPages]);
    
    const renderPage = useCallback(async (pageNum: number) => {
        if (!pdfDoc) return;
        try {
            const page = await pdfDoc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.5 });
            
            const canvas = document.getElementById(`canvas-${pageNum}`) as HTMLCanvasElement;
            const context = canvas?.getContext('2d');
            if (!context) return;
    
            canvas.height = viewport.height;
            canvas.width = viewport.width;
    
            await page.render({ canvasContext: context, viewport }).promise;
            
            const textLayerDiv = document.getElementById(`text-layer-${pageNum}`) as HTMLDivElement;
            if (textLayerDiv) {
                textLayerDiv.innerHTML = '';
                const textContent = await page.getTextContent();
                
                const textLayer = new TextLayerBuilder({
                    textLayerDiv,
                    pageIndex: page.pageNumber - 1,
                    viewport,
                });
    
                textLayer.setTextContentSource(textContent);
                textLayer.render();
            }
        } catch(error) {
            console.error(`Failed to render page ${pageNum}`, error);
        }
    }, [pdfDoc]);

    useEffect(() => {
        if (pdfDoc) {
            for (let i = 1; i <= totalPages; i++) {
                renderPage(i);
            }
        }
    }, [totalPages, pdfDoc, renderPage]);

    if (!file) {
      return <div className="pdf-viewer-container placeholder"><p>Upload a PDF to begin your Q&A session.</p></div>;
    }

    return (
        <div className="pdf-viewer-container">
            {Array.from(new Array(totalPages), (el, index) => (
                <div key={index + 1} id={`page-${index + 1}`} className="pdf-page">
                    <div className="canvas-wrapper">
                        <canvas id={`canvas-${index + 1}`}></canvas>
                        <div id={`text-layer-${index + 1}`} className="textLayer"></div>
                    </div>
                </div>
            ))}
        </div>
    );
};


const App = () => {
  const [reviewMode, setReviewMode] = useState<'thesis' | 'manuscript' | 'think_tank' | 'pdf_qa'>('thesis');
  const [documentText, setDocumentText] = useState('');
  const [researchTopic, setResearchTopic] = useState('');
  const [fileName, setFileName] = useState('');
  const [feedback, setFeedback] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isDevilsAdvocate, setIsDevilsAdvocate] = useState(false);
  const [reviewSections, setReviewSections] = useState<string[]>(defaultThesisSections);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [highlightText, setHighlightText] = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [userQuestion, setUserQuestion] = useState('');
  const chatHistoryRef = useRef<HTMLDivElement>(null);


  const reviewOptions = reviewMode === 'thesis' ? thesisReviewOptions : manuscriptReviewOptions;

  useEffect(() => {
      if (chatHistoryRef.current) {
        chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
      }
  }, [chatHistory]);

  useEffect(() => {
    if (reviewMode === 'thesis') {
        setReviewSections(defaultThesisSections);
    } else if (reviewMode === 'manuscript') {
        setReviewSections(defaultManuscriptSections);
    } else {
        setReviewSections([]);
    }
    setFeedback('');
    setHighlightText(null);
    if(reviewMode !== 'pdf_qa') {
        setChatHistory([]);
    }
  }, [reviewMode]);

  const renderFeedback = (text: string) => {
    if (!text) return { __html: '' };
    if(reviewMode === 'think_tank') return null;
    const formattedText = text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br />');
    return { __html: formattedText };
  };
  
  const handleFileParse = async (file: File) => {
    setIsLoading(true);
    setError('');
    setDocumentText('');
    setFileName('');
    setPdfFile(null);
    setHighlightText(null);
    setChatHistory([]);
    try {
      if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        setDocumentText(result.value);
        setPdfFile(null);
      } else if (file.type === 'application/pdf') {
        setPdfFile(file);
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(new Uint8Array(arrayBuffer)).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          fullText += textContent.items.map(item => 'str' in item ? item.str : '').join(' ');
          fullText += '\n\n';
        }
        setDocumentText(fullText);
        if (reviewMode === 'pdf_qa') {
            setChatHistory([{ role: 'model', text: 'Document loaded. Ask me anything about its content.'}]);
        }
      } else {
        throw new Error('Unsupported file type. Please upload a .docx or .pdf file.');
      }
      setFileName(file.name);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred during file parsing.';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileParse(file);
    }
  };

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFileParse(file);
    }
  }, []);

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };
  
  const clearFile = () => {
    setDocumentText('');
    setFileName('');
    setPdfFile(null);
    setHighlightText(null);
    setChatHistory([]);
    setUserQuestion('');
  }

  const handleReview = async () => {
    if ((reviewMode === 'thesis' || reviewMode === 'manuscript') && !documentText.trim()) {
        setError('Please upload a document first.');
        return;
    }
    if (reviewMode === 'think_tank' && !researchTopic.trim()) {
        setError('Please enter a research topic.');
        return;
    }
    if ((reviewMode === 'thesis' || reviewMode === 'manuscript') && reviewSections.length === 0) {
        setError('Please select at least one review focus area.');
        return;
    }

    setIsLoading(true);
    setError('');
    setFeedback('');
    setHighlightText(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
      
      let prompt;
      let config = {};

      if(reviewMode === 'think_tank') {
          const devilsAdvocateInstruction = isDevilsAdvocate ? `
          **Devil's Advocate Mode Active:** Scrutinize every assumption. For each methodological step, identify the weakest point and propose a more robust alternative. Challenge the novelty of the research questions. The goal is a pressure-tested, highly defensible plan.
          ` : '';
          
          prompt = `
          ${devilsAdvocateInstruction}
          Act as an expert research strategist. Based on the topic "${researchTopic}", generate a comprehensive research plan. The output MUST be a JSON object matching the provided schema.

          The plan must include:
          1.  A compelling title and a structured abstract.
          2.  A brief introduction establishing the research gap.
          3.  2-3 specific research questions.
          4.  A methodology flowchart with sequential stages. Steps that can occur in parallel should be in the same stage.
          5.  For quantitative analysis steps, if applicable, include a relevant mathematical theorem or principle (e.g., Central Limit Theorem, Bayes' Theorem) that underpins the method.
          6.  A clear statement of the expected contribution and potential limitations.
          `;
          config = {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    abstract: { type: Type.STRING },
                    introduction: { type: Type.STRING },
                    researchQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
                    methodologyFlowchart: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                stage: { type: Type.INTEGER },
                                title: { type: Type.STRING },
                                steps: {
                                    type: Type.ARRAY,
                                    items: {
                                        type: Type.OBJECT,
                                        properties: {
                                            id: { type: Type.STRING },
                                            title: { type: Type.STRING },
                                            details: { type: Type.STRING },
                                            theorem: {
                                                type: Type.OBJECT,
                                                properties: {
                                                    name: { type: Type.STRING },
                                                    explanation: { type: Type.STRING }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    contribution: { type: Type.STRING },
                    limitations: { type: Type.STRING }
                }
            }
          };
      } else {
        const currentReviewOptions = reviewMode === 'thesis' ? thesisReviewOptions : manuscriptReviewOptions;
        const selectedPrompts = reviewSections.map(key => currentReviewOptions[key].prompt).join('\n\n');
        let devilsAdvocateInstruction = '';
        let basePrompt = '';

        if (reviewMode === 'thesis') {
            devilsAdvocateInstruction = `You are now in "Devil's Advocate" mode. Act as a skeptical, highly critical, but fair professor. Your goal is to challenge the author's assumptions, methodology, and conclusions to strengthen their work. Frame your feedback as probing questions and critical observations.`;
            basePrompt = `
            As an expert design thesis reviewer, analyze the following thesis text. Provide a detailed review covering these selected areas:
            ${selectedPrompts}
            Structure your feedback clearly with markdown formatting.
            ---
            ${documentText}
            ---
            `;
        } else { // Manuscript Mode
            devilsAdvocateInstruction = `You are now in "Devil's Advocate" mode, acting as 'Reviewer #2'. You are known for your rigorous, skeptical reviews for top-tier journals. Find every potential flaw, weak argument, or methodological ambiguity. Your tone should be professionally critical.`;
            basePrompt = `
            As an expert peer reviewer for a high-impact journal, provide a critical review of the following manuscript draft. Focus on the selected areas below.
            ${selectedPrompts}
            Structure your feedback clearly, using markdown for headings.
            ---
            ${documentText}
            ---
            `;
        }
        prompt = isDevilsAdvocate ? devilsAdvocateInstruction + basePrompt : basePrompt;
      }
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      setFeedback(response.text);

    } catch (err) {
      console.error(err);
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(`Failed to get review. Please try again. Error: ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userQuestion.trim() || !documentText.trim()) return;

    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', text: userQuestion }];
    setChatHistory(newHistory);
    setUserQuestion('');
    setIsLoading(true);
    setError('');

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
        const prompt = `
            Based *only* on the provided document text, answer the following question.
            Your response must be a JSON object.
            1. In the 'answer' field, provide a clear, concise answer to the question.
            2. In the 'quote' field, provide a short, direct quote from the document that best supports your answer. This quote must be exact.

            Question: "${userQuestion}"

            Document Text:
            ---
            ${documentText}
            ---
        `;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        answer: { type: Type.STRING },
                        quote: { type: Type.STRING },
                    },
                },
            },
        });
        
        const parsedResponse = JSON.parse(response.text);
        const modelMessage: ChatMessage = {
            role: 'model',
            text: parsedResponse.answer,
            quote: parsedResponse.quote
        };

        setChatHistory([...newHistory, modelMessage]);
        if(parsedResponse.quote) {
            setHighlightText(parsedResponse.quote);
        }

    } catch (err) {
        console.error("Error sending message:", err);
        const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred.';
        setError(`Failed to get an answer. Error: ${errorMessage}`);
        // Add error message to chat
        setChatHistory([...newHistory, {role: 'model', text: `Sorry, I encountered an error: ${errorMessage}`}]);
    } finally {
        setIsLoading(false);
    }
  };


  const handleSectionChange = (sectionKey: string) => {
    setReviewSections(prev => 
      prev.includes(sectionKey) 
        ? prev.filter(s => s !== sectionKey)
        : [...prev, sectionKey]
    );
  };
  
  const handleDownload = async () => {
    if(!feedback) return;

    let doc;
    
    if(reviewMode === 'think_tank') {
        try {
            const plan: ResearchPlan = JSON.parse(feedback);
            const children = [
                new Paragraph({ text: plan.title, heading: HeadingLevel.TITLE }),
                new Paragraph({ text: "Abstract", heading: HeadingLevel.HEADING_1 }),
                new Paragraph(plan.abstract),
                new Paragraph({ text: "Introduction", heading: HeadingLevel.HEADING_1 }),
                new Paragraph(plan.introduction),
                new Paragraph({ text: "Research Questions", heading: HeadingLevel.HEADING_1 }),
                ...plan.researchQuestions.map(q => new Paragraph({ text: q, bullet: { level: 0 } })),
                new Paragraph({ text: "Methodology", heading: HeadingLevel.HEADING_1 }),
                ...plan.methodologyFlowchart.flatMap(stage => [
                    new Paragraph({ text: `Stage ${stage.stage}: ${stage.title}`, heading: HeadingLevel.HEADING_2 }),
                    ...stage.steps.flatMap(step => [
                        new Paragraph({ text: step.title, heading: HeadingLevel.HEADING_3 }),
                        new Paragraph(step.details),
                        ...(step.theorem ? [
                            new Paragraph({
                                children: [
                                    new TextRun({ text: "Supporting Principle: ", bold: true }),
                                    new TextRun(step.theorem.name)
                                ]
                            }),
                            new Paragraph(step.theorem.explanation)
                        ] : [])
                    ])
                ]),
                new Paragraph({ text: "Expected Contribution", heading: HeadingLevel.HEADING_1 }),
                new Paragraph(plan.contribution),
                new Paragraph({ text: "Potential Limitations", heading: HeadingLevel.HEADING_1 }),
                new Paragraph(plan.limitations),
            ];
             doc = new Document({ sections: [{ children }] });
        } catch(e) {
            setError("Could not parse research plan for download.");
            return;
        }

    } else {
        const paragraphs = feedback.split('\n').map(line => {
          const children = [];
          const parts = line.split('**');
          parts.forEach((part, index) => {
            if (part) {
              children.push(new TextRun({ text: part, bold: index % 2 === 1 }));
            }
          });
          return new Paragraph({ children });
        });
        doc = new Document({ sections: [{ children: paragraphs }] });
    }

    const blob = await Packer.toBlob(doc);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const downloadName = reviewMode === 'think_tank' ? 'research-plan' : `${reviewMode}-review-feedback`;
    link.download = `${downloadName}.docx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getButtonText = () => {
    if (isLoading) return 'Processing...';
    if (reviewMode === 'thesis') {
      return isDevilsAdvocate ? 'Challenge Thesis' : 'Review Thesis';
    }
    if (reviewMode === 'manuscript') {
      return isDevilsAdvocate ? 'Critique Manuscript' : 'Review Manuscript';
    }
    if (reviewMode === 'think_tank') {
      return isDevilsAdvocate ? 'Pressure-Test Plan' : 'Generate Plan';
    }
    return 'Start';
  };

  const isButtonDisabled = () => {
    if(isLoading) return true;
    if(reviewMode === 'think_tank') return !researchTopic;
    return !documentText;
  }
  
  let parsedPlan = null;
  if (reviewMode === 'think_tank' && feedback) {
    try {
        parsedPlan = JSON.parse(feedback);
    } catch (e) {
        if (!isLoading) {
            setError("The generated plan was not in the correct format. Please try again.");
            setFeedback(''); // Clear broken feedback
        }
    }
  }

  return (
    <div className="container">
      <header>
        <h1>Academic Think Thank Reviewer</h1>
        <p>Upload your document, select your focus areas, and get AI-powered feedback to elevate your work.</p>
      </header>
      <main>
        <div className="mode-switcher">
          <button 
            className={`mode-button ${reviewMode === 'thesis' ? 'active' : ''}`}
            onClick={() => setReviewMode('thesis')}
            aria-pressed={reviewMode === 'thesis'}
          >
            Thesis Review
          </button>
          <button 
            className={`mode-button ${reviewMode === 'manuscript' ? 'active' : ''}`}
            onClick={() => setReviewMode('manuscript')}
            aria-pressed={reviewMode === 'manuscript'}
          >
            Manuscript Review
          </button>
          <button 
            className={`mode-button ${reviewMode === 'think_tank' ? 'active' : ''}`}
            onClick={() => setReviewMode('think_tank')}
            aria-pressed={reviewMode === 'think_tank'}
          >
            Think Tank
          </button>
          <button 
            className={`mode-button ${reviewMode === 'pdf_qa' ? 'active' : ''}`}
            onClick={() => setReviewMode('pdf_qa')}
            aria-pressed={reviewMode === 'pdf_qa'}
          >
            PDF Q&A
          </button>
        </div>

        {reviewMode === 'thesis' || reviewMode === 'manuscript' || reviewMode === 'pdf_qa' ? (
            <section className="input-section">
              <h2>1. Upload Your Document</h2>
              <div 
                className="file-drop-zone" 
                onDrop={handleDrop} 
                onDragOver={handleDragOver}
                onClick={() => document.getElementById('file-input')?.click()}
              >
                <input 
                  id="file-input"
                  type="file" 
                  accept=".docx,.pdf" 
                  onChange={handleFileChange} 
                  style={{ display: 'none' }}
                />
                <p>
                  Drag & drop your .docx or .pdf file here, or click to select a file.
                  {reviewMode === 'pdf_qa' && <strong> PDF required for Q&A.</strong>}
                </p>
              </div>
              {fileName && (
                <div className="file-info">
                  <span>{fileName}</span>
                  <button onClick={clearFile}>Clear</button>
                </div>
              )}
            </section>
        ) : null}

        {reviewMode === 'thesis' || reviewMode === 'manuscript' ? (
            <section>
              <h2>2. Select Review Focus Areas</h2>
              <div className="review-options-grid">
                {Object.entries(reviewOptions).map(([key, { label }]) => (
                  <div key={key} className="checkbox-wrapper">
                    <input 
                      type="checkbox" 
                      id={`checkbox-${key}`} 
                      checked={reviewSections.includes(key)} 
                      onChange={() => handleSectionChange(key)}
                    />
                    <label htmlFor={`checkbox-${key}`}>{label}</label>
                  </div>
                ))}
              </div>
            </section>
        ) : null}
        
        {reviewMode === 'think_tank' ? (
          <section>
            <h2>1. Enter Your Research Topic</h2>
            <textarea 
              className="topic-input"
              value={researchTopic}
              onChange={(e) => setResearchTopic(e.target.value)}
              placeholder="e.g., The impact of AI-driven personalization on user engagement in e-commerce platforms."
              aria-label="Research Topic"
            />
          </section>
        ) : null}

        {(reviewMode === 'thesis' || reviewMode === 'manuscript' || reviewMode === 'think_tank') && (
            <section className="review-controls">
            <h2>{reviewMode === 'think_tank' ? '2. Generate Plan' : '3. Start the Review'}</h2>
            <div className="controls-container">
                {reviewMode !== 'pdf_qa' && (
                    <div className="toggle-wrapper">
                        <label htmlFor="devils-advocate-toggle" className="toggle-label">Advocator</label>
                        <div className="toggle-switch">
                            <input
                                type="checkbox"
                                id="devils-advocate-toggle"
                                checked={isDevilsAdvocate}
                                onChange={() => setIsDevilsAdvocate(!isDevilsAdvocate)}
                                aria-checked={isDevilsAdvocate}
                            />
                            <span className="toggle-slider"></span>
                        </div>
                    </div>
                )}
                <button 
                className="review-button" 
                onClick={handleReview} 
                disabled={isButtonDisabled()}
                aria-busy={isLoading}
                >
                {getButtonText()}
                </button>
            </div>
            </section>
        )}

        {error && <p className="error-message" role="alert">{error}</p>}
        
        <section className="output-section">
          <div className="output-header">
            <h2>
              {reviewMode === 'think_tank' ? 'Generated Research Plan'
                : reviewMode === 'pdf_qa' ? 'Interactive Document Q&A'
                : "Reviewer's Feedback"}
            </h2>
            {feedback && !isLoading && (reviewMode === 'think_tank' || reviewMode === 'thesis' || reviewMode === 'manuscript') && (
              <button className="download-button" onClick={handleDownload}>
                {reviewMode === 'think_tank' ? 'Download Plan' : 'Download Feedback'}
              </button>
            )}
          </div>
            {isLoading && !feedback && chatHistory.length <=1 ? (
               <div className="feedback-container" aria-live="polite">
                <div className="loader" aria-label="Loading..."></div>
               </div>
            ) : reviewMode === 'think_tank' ? (
                <div className="feedback-container" aria-live="polite">
                    {parsedPlan ? <ResearchPlanRenderer plan={parsedPlan} /> : <p className="placeholder-text">Your research plan will appear here.</p>}
                </div>
            ) : reviewMode === 'pdf_qa' ? (
                <div className="qa-output-container">
                    <div className="pdf-view">
                        <PDFViewer file={pdfFile} highlightText={highlightText} />
                    </div>
                    <div className="chat-view">
                        <div className="chat-history" ref={chatHistoryRef}>
                            {chatHistory.map((msg, index) => (
                                <div key={index} className={`chat-message ${msg.role}`}>
                                    <p>{msg.text}</p>
                                    {msg.quote && (
                                        <blockquote className="quote" onClick={() => setHighlightText(msg.quote!)} onKeyDown={(e) => e.key === 'Enter' && setHighlightText(msg.quote!)} tabIndex={0} role="button">
                                            {msg.quote}
                                        </blockquote>
                                    )}
                                </div>
                            ))}
                            {isLoading && <div className="chat-message model"><div className="loader" style={{margin: 0}}></div></div>}
                        </div>
                        <div className="chat-input-area">
                            <form className="chat-input-form" onSubmit={handleSendMessage}>
                                <textarea
                                    value={userQuestion}
                                    onChange={(e) => setUserQuestion(e.target.value)}
                                    placeholder={pdfFile ? "Ask a question about the PDF..." : "Please upload a PDF first."}
                                    aria-label="Your question"
                                    disabled={!pdfFile || isLoading}
                                />
                                <button type="submit" disabled={!pdfFile || isLoading || !userQuestion.trim()}>Send</button>
                            </form>
                        </div>
                    </div>
                </div>
            ) : (
              <div className="feedback-container" aria-live="polite">
                {feedback ? <div dangerouslySetInnerHTML={renderFeedback(feedback)} /> : <p className="placeholder-text">Your feedback will appear here.</p>}
              </div>
            )}
        </section>
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);