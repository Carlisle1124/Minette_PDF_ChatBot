// Allow Vite's ?url imports (for assets like pdf.worker?url)
declare module '*?url' { const value: string; export default value; }

