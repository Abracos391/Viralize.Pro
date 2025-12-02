import React, { useState } from 'react';
import { VideoInputData, DurationOption, TargetPlatform } from '../types';
import { Sparkles, ArrowRight, Zap } from 'lucide-react';

interface InputFormProps {
  onSubmit: (data: VideoInputData) => void;
  isGenerating: boolean;
}

export const InputForm: React.FC<InputFormProps> = ({ onSubmit, isGenerating }) => {
  const [formData, setFormData] = useState<VideoInputData>({
    productName: '',
    description: '',
    targetAudience: '',
    duration: DurationOption.SHORT,
    platform: TargetPlatform.TIKTOK,
    url: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  if (isGenerating) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-8 animate-in fade-in zoom-in duration-500">
        <div className="relative">
            <div className="absolute inset-0 bg-brand-500 blur-3xl opacity-20 rounded-full animate-pulse-fast"></div>
            <div className="w-24 h-24 border-4 border-brand-500 border-t-transparent rounded-full animate-spin relative z-10"></div>
            <div className="absolute inset-0 flex items-center justify-center z-10">
                <Sparkles className="text-brand-400 animate-pulse" size={32} />
            </div>
        </div>
        <div>
            <h2 className="text-3xl font-bold text-white mb-2">Viralize Pro AI is working...</h2>
            <p className="text-gray-400 text-lg">Analyzing trends, writing script, and optimizing retention.</p>
        </div>
        <div className="flex gap-2 text-sm text-gray-500 font-mono">
           <span>[SEO OPTIMIZATION]</span>
           <span className="animate-pulse">...</span>
           <span>[AUDIO SYNC]</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto bg-gray-900 border border-gray-800 rounded-3xl p-8 shadow-2xl relative overflow-hidden">
      {/* Decorative background glow */}
      <div className="absolute top-0 right-0 -mr-20 -mt-20 w-64 h-64 bg-brand-600/10 rounded-full blur-3xl"></div>
      <div className="absolute bottom-0 left-0 -ml-20 -mb-20 w-64 h-64 bg-accent-600/10 rounded-full blur-3xl"></div>

      <div className="relative z-10 mb-8">
        <div className="inline-flex items-center gap-2 bg-brand-900/30 border border-brand-500/20 text-brand-400 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-4">
            <Zap size={14} />
            Beta Version
        </div>
        <h1 className="text-4xl font-black text-white mb-2 tracking-tight">Create Viral Content</h1>
        <p className="text-gray-400">Transform static product ideas into high-retention video scripts in seconds.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-300">Product / Brand Name</label>
            <input
              required
              name="productName"
              value={formData.productName}
              onChange={handleChange}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none"
              placeholder="e.g. SlimFit Pro"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-300">Target Audience</label>
            <input
              required
              name="targetAudience"
              value={formData.targetAudience}
              onChange={handleChange}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none"
              placeholder="e.g. Busy moms, Tech geeks"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-300">Core Value Proposition / Description</label>
          <textarea
            required
            name="description"
            value={formData.description}
            onChange={handleChange}
            rows={3}
            className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none"
            placeholder="Describe what makes it special. Paste a URL or features list here."
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-300">Platform</label>
            <select
              name="platform"
              value={formData.platform}
              onChange={handleChange}
              className="w-full bg-gray-800 border border-gray-700 rounded-xl px-4 py-3 text-white focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all outline-none appearance-none"
            >
              <option value={TargetPlatform.TIKTOK}>TikTok</option>
              <option value={TargetPlatform.REELS}>Instagram Reels</option>
              <option value={TargetPlatform.SHORTS}>YouTube Shorts</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-gray-300">Format Duration</label>
            <div className="flex gap-4">
              <label className={`flex-1 cursor-pointer border rounded-xl p-3 flex items-center justify-center transition-all ${formData.duration === DurationOption.SHORT ? 'bg-brand-600 border-brand-500 text-white shadow-lg shadow-brand-900/50' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}>
                <input type="radio" name="duration" value={DurationOption.SHORT} checked={formData.duration === DurationOption.SHORT} onChange={handleChange} className="hidden" />
                <span className="font-bold">15s (6 Scenes)</span>
              </label>
              <label className={`flex-1 cursor-pointer border rounded-xl p-3 flex items-center justify-center transition-all ${formData.duration === DurationOption.LONG ? 'bg-brand-600 border-brand-500 text-white shadow-lg shadow-brand-900/50' : 'bg-gray-800 border-gray-700 text-gray-400 hover:bg-gray-700'}`}>
                <input type="radio" name="duration" value={DurationOption.LONG} checked={formData.duration === DurationOption.LONG} onChange={handleChange} className="hidden" />
                <span className="font-bold">30s (10 Scenes)</span>
              </label>
            </div>
          </div>
        </div>

        <button
          type="submit"
          className="w-full group relative flex items-center justify-center gap-2 bg-gradient-to-r from-brand-600 to-brand-500 hover:from-brand-500 hover:to-brand-400 text-white text-lg font-bold py-4 rounded-xl shadow-lg shadow-brand-900/50 transition-all transform hover:-translate-y-1"
        >
          <Sparkles size={20} className="group-hover:rotate-12 transition-transform" />
          Generate Viral Script
          <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </button>
      </form>
    </div>
  );
};