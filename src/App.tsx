import React, { useState, useEffect, useRef } from 'react';
import { Loader2, Send, Code2, TextCursor as Cursor, X } from 'lucide-react';

interface Message {
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
}

const AI_MODELS = [
  { id: 'deepseek-r1-distill-qwen-1.5b', name: 'Deepseek R1 Distill Qwen 1.5B' },
  { id: 'qwen2.5-coder-7b-instruct-mlx', name: 'Qwen coder 7b' },
  { id: 'mistral-7b', name: 'Mistral 7B' },
  { id: 'neural-chat-7b', name: 'Neural Chat 7B' }
];

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [generatedCode, setGeneratedCode] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [selectedModel, setSelectedModel] = useState(AI_MODELS[0].id);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedElement, setSelectedElement] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingContent]);

  // Handle messages from the iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'elementSelected') {
        setSelectedElement(event.data.selector);
        setIsSelecting(false);
        setInput(`Modify the ${event.data.tagName.toLowerCase()} element with selector: ${event.data.selector}`);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Update iframe content with selection script
  useEffect(() => {
    if (!iframeRef.current) return;

    const injectSelectionScript = () => {
      const iframe = iframeRef.current;
      if (!iframe?.contentWindow) return;

      // Create a complete HTML document with the script already included
      const fullHtml = `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="utf-8">
            <style>
              @import url('https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css');
              .hover-highlight {
                outline: 2px solid #3b82f6 !important;
                outline-offset: 2px !important;
              }
              .selected-element {
                outline: 2px solid #10b981 !important;
                outline-offset: 2px !important;
              }
              ${isSelecting ? '* { cursor: pointer !important; }' : ''}
            </style>
            <script>
              (function() {
                let currentHighlight = null;
                let selectedElement = null;
                let isSelectingMode = ${isSelecting};

                function handleMouseOver(e) {
                  if (!isSelectingMode) return;
                  if (currentHighlight) {
                    currentHighlight.classList.remove('hover-highlight');
                  }
                  currentHighlight = e.target;
                  currentHighlight.classList.add('hover-highlight');
                  e.stopPropagation();
                }

                function handleMouseOut(e) {
                  if (!isSelectingMode) return;
                  if (currentHighlight) {
                    currentHighlight.classList.remove('hover-highlight');
                    currentHighlight = null;
                  }
                }

                function handleClick(e) {
                  if (!isSelectingMode) return;
                  e.preventDefault();
                  e.stopPropagation();
                  
                  if (selectedElement) {
                    selectedElement.classList.remove('selected-element');
                  }
                  
                  selectedElement = e.target;
                  selectedElement.classList.add('selected-element');

                  // Generate a unique selector for the element
                  let selector = '';
                  let element = e.target;
                  
                  while (element !== document.body && element.parentNode) {
                    let tag = element.tagName.toLowerCase();
                    let siblings = Array.from(element.parentNode.children);
                    if (siblings.length > 1) {
                      let index = siblings.indexOf(element) + 1;
                      selector = \`\${tag}:nth-child(\${index})\${selector ? ' > ' + selector : ''}\`;
                    } else {
                      selector = tag + (selector ? ' > ' + selector : '');
                    }
                    element = element.parentNode;
                  }

                  window.parent.postMessage({
                    type: 'elementSelected',
                    selector,
                    tagName: e.target.tagName
                  }, '*');
                }

                // Setup event listeners
                document.addEventListener('mouseover', handleMouseOver, true);
                document.addEventListener('mouseout', handleMouseOut, true);
                document.addEventListener('click', handleClick, true);

                // Listen for selection mode changes
                window.addEventListener('message', (event) => {
                  if (event.data.type === 'updateSelectionMode') {
                    isSelectingMode = event.data.isSelecting;
                    
                    if (!isSelectingMode && currentHighlight) {
                      currentHighlight.classList.remove('hover-highlight');
                      currentHighlight = null;
                    }
                    
                    document.body.style.cursor = isSelectingMode ? 'pointer' : '';
                  }
                });
              })();
            </script>
          </head>
          <body>
            ${generatedCode}
          </body>
        </html>
      `;

      // Update the iframe content
      iframe.srcdoc = fullHtml;
    };

    injectSelectionScript();
  }, [isSelecting, generatedCode]);

  const formatCodeBlock = (content: string) => {
    const codeMatch = content.match(/```(?:html)?(.*?)```/s);
    if (!codeMatch) return content;

    const beforeCode = content.slice(0, content.indexOf('```'));
    const code = codeMatch[1].trim();
    const afterCode = content.slice(content.indexOf('```', content.indexOf('```') + 3) + 3);

    return (
      <>
        {beforeCode && <p className="mb-4">{beforeCode}</p>}
        <div className="relative bg-gray-900 rounded-lg p-4 mb-4">
          <div className="absolute top-3 right-3 flex items-center gap-2">
            <Code2 className="w-4 h-4 text-gray-400" />
            <span className="text-xs text-gray-400">HTML</span>
          </div>
          <pre className="text-sm overflow-x-auto">
            <code className="language-html">{code}</code>
          </pre>
        </div>
        {afterCode && <p>{afterCode}</p>}
      </>
    );
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    
    const userMessage: Message = {
      content: input,
      role: 'user',
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsGenerating(true);
    setStreamingContent('');
    setSelectedElement(null);

    try {
      const controller = new AbortController();
      const response = await fetch('http://192.168.180.107:1234/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: selectedModel,
          messages: [
            {
              role: 'system',
              content: 'You are a helpful AI web developer assistant that generates HTML code based on user descriptions.Your response should be only in code format and code format alone ...the user would give you a request, and you would try to make  the most beautiful design of it as possible. You are to use tailwind css for 95% of your styling unless when not possible to use it or when the user explicitly says against using it.'
            },
            ...messages.map(msg => ({
              role: msg.role,
              content: msg.content
            })),
            {
              role: 'user',
              content: input
            }
          ],
          temperature: 0.7,
          max_tokens: -1,
          stream: true
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error('Failed to generate response');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      if (reader) {
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              // Save the final message
              const assistantMessage: Message = {
                content: fullContent,
                role: 'assistant',
                timestamp: new Date()
              };
              setMessages(prev => [...prev, assistantMessage]);
              
              // Extract code from the message if it contains HTML
              const codeMatch = fullContent.match(/```(?:html)?(.*?)```/s);
              setGeneratedCode(codeMatch ? codeMatch[1].trim() : '');
              break;
            }

            const chunk = decoder.decode(value);
            const lines = chunk.split('\n').filter(line => line.trim() !== '');

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.choices[0].delta?.content) {
                    const newContent = data.choices[0].delta.content;
                    fullContent += newContent;
                    setStreamingContent(fullContent);
                  }
                } catch (e) {
                  console.warn('Error parsing JSON from stream:', e);
                  // Continue processing even if one line fails
                  continue;
                }
              }
            }
          }
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') {
            console.log('Fetch aborted');
          } else {
            throw error;
          }
        } finally {
          reader.releaseLock();
        }
      }
    } catch (error) {
      console.error('Error generating response:', error);
      const errorMessage: Message = {
        content: 'Sorry, I encountered an error while generating the response.',
        role: 'assistant',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsGenerating(false);
      setStreamingContent('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-gray-900 text-white overflow-hidden">
      {/* Header */}
      <header className="border-b border-gray-800 px-4 py-3 flex-shrink-0">
        <div className="container mx-auto flex items-center justify-between">
          <h1 className="text-base font-bold">AI Web Builder</h1>
          <div className="flex items-center gap-4">
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-md px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {AI_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <div className={`h-2 w-2 rounded-full ${isGenerating ? 'bg-green-500 animate-pulse' : 'bg-gray-500'}`} />
            <span className="text-sm text-gray-400">
              {isGenerating ? 'Generating...' : 'Ready'}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 px-4 py-3 overflow-hidden">
        <div className="flex items-center gap-4 h-full">
          {/* Chat Section */}
          <div className="bg-gray-800 w-1/3 h-full rounded-lg flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`p-4 rounded-lg ${
                    message.role === 'user' 
                      ? 'bg-blue-600' 
                      : 'bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold">
                      {message.role === 'user' ? 'You' : 'AI'}
                    </span>
                    <span className="text-xs text-gray-400">
                      {message.timestamp.toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="prose prose-invert max-w-none text-sm">
                    {formatCodeBlock(message.content)}
                  </div>
                </div>
              ))}
              {isGenerating && streamingContent && (
                <div className="p-4 rounded-lg bg-gray-700">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-sm font-semibold">AI</span>
                    <Loader2 className="w-4 h-4 animate-spin" />
                  </div>
                  <div className="prose prose-invert max-w-none text-sm">
                    {formatCodeBlock(streamingContent)}
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
            
            <div className="p-4 border-t border-gray-700">
              <div className="relative">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Describe what you want to build..."
                  className="w-full bg-gray-700 text-white p-4 pr-12 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={3}
                />
                <button
                  onClick={sendMessage}
                  disabled={isGenerating || !input.trim()}
                  className="absolute right-2 bottom-2 p-2 text-gray-400 hover:text-white disabled:text-gray-600 disabled:cursor-not-allowed transition-colors"
                >
                  {isGenerating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Preview Section */}
          <div className="bg-gray-800 rounded-lg flex-1 h-full flex flex-col overflow-hidden">
            <div className="p-4 border-b border-gray-700 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Preview</h2>
              <div className="flex items-center gap-2">
                {selectedElement && (
                  <span className="text-xs text-gray-400">
                    Selected: {selectedElement}
                  </span>
                )}
                <button
                  onClick={() => setIsSelecting(!isSelecting)}
                  className={`p-1.5 rounded-md transition-colors ${
                    isSelecting
                      ? 'bg-blue-500 text-white hover:bg-blue-600'
                      : 'bg-gray-700 text-gray-400 hover:text-white'
                  }`}
                  title={isSelecting ? 'Cancel selection' : 'Select element to modify'}
                >
                  {isSelecting ? (
                    <X className="w-4 h-4" />
                  ) : (
                    <Cursor className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
            <div className="flex-1 bg-white overflow-auto">
              <iframe
                ref={iframeRef}
                srcDoc=""
                className="w-full h-full border-none"
                title="Preview"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;