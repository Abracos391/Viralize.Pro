import React, { useState } from 'react';
import { InputForm } from './components/InputForm';
import { VideoPlayer } from './components/VideoPlayer';
import { AppState, VideoInputData, GeneratedScript } from './types';
import { generateVideoScript } from './services/geminiService';
import { Video, Layers, BarChart3, AlertCircle } from 'lucide-react';

const App: React.FC = () => {
  const [appState, setAppState] = useState<AppState>('input');
  const [script, setScript] = useState<GeneratedScript | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (data: VideoInputData) => {
    setAppState('generating');
    setError(null);
    try {
      const generatedScript = await generateVideoScript(data);
      setScript(generatedScript);
      setAppState('preview');
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to generate video script. Please check your API key.");
      setAppState('input');
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-brand-500">
            <Video size={28} />
            <span className="text-xl font-black tracking-tight text-white">Viralize<span className="text-brand-500">Pro</span></span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-400">
            <span className="flex items-center gap-2 hover:text-white cursor-pointer transition-colors"><Layers size={16} /> Templates</span>
            <span className="flex items-center gap-2 hover:text-white cursor-pointer transition-colors"><BarChart3 size={16} /> Analytics</span>
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-500 to-accent-600 border border-white/20"></div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col p-4 md:p-8">
        
        {error && (
          <div className="max-w-2xl mx-auto w-full mb-6 bg-red-900/20 border border-red-500/50 text-red-200 px-4 py-3 rounded-xl flex items-center gap-3">
            <AlertCircle size={20} />
            <p>{error}</p>
          </div>
        )}

        {appState === 'input' && (
          <div className="flex-1 flex items-center justify-center animate-in fade-in duration-500">
            <InputForm onSubmit={handleGenerate} isGenerating={false} />
          </div>
        )}

        {appState === 'generating' && (
           <div className="flex-1 flex items-center justify-center">
            <InputForm onSubmit={() => {}} isGenerating={true} />
           </div>
        )}

        {appState === 'preview' && script && (
          <div className="animate-in slide-in-from-bottom-8 duration-700">
             <VideoPlayer script={script} onEditRequest={() => setAppState('input')} />
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 py-6 text-center text-gray-600 text-sm">
        <p>© 2025 Viralize Pro AI. Optimized for high-retention content.</p>
      </footer>
    </div>
  );
};

export default App;