/* Shared Index 2 formulas; all spatial inputs are caller-owned. */
const Index2LightColors = (() => {
function draw(type, c, { width, height, time, colorTime, currentBreathHue }) {
            const color = colorTime;
            switch (type) {
                case 'chroma-spectrum':
                    const hue = (color * 80) % 360;
                    const gradS = c.createRadialGradient(width/2, height/2, 50, width/2, height/2, Math.max(width, height) * 0.7);
                    gradS.addColorStop(0, `hsl(${hue}, 100%, 65%)`);
                    gradS.addColorStop(0.5, `hsl(${(hue + 40) % 360}, 100%, 45%)`);
                    gradS.addColorStop(1, `hsl(${(hue + 90) % 360}, 100%, 25%)`);
                    c.fillStyle = gradS; c.fillRect(0, 0, width, height);
                    break;

                case 'chroma-pulse':
                    c.fillStyle = '#030308'; c.fillRect(0, 0, width, height);
                    const baseHueP = (color * 70) % 360;
                    for (let i = 5; i >= 1; i--) {
                        const radius = (Math.max(width, height) * 0.6 / 5) * i * (Math.sin(color * 2.5 + i * 0.8) * 0.2 + 1);
                        const gradP = c.createRadialGradient(width/2, height/2, 0, width/2, height/2, radius);
                        gradP.addColorStop(0, `hsla(${(baseHueP + i * 45) % 360}, 100%, 60%, 0.8)`);
                        gradP.addColorStop(1, 'transparent');
                        c.fillStyle = gradP; c.beginPath(); c.arc(width/2, height/2, radius, 0, Math.PI * 2); c.fill();
                    }
                    break;

                case 'chroma-aurora':
                    c.fillStyle = '#010408'; c.fillRect(0, 0, width, height);
                    const aHue1 = (color * 30 + 120) % 360;
                    const aHue2 = (color * 40 + 200) % 360;
                    const aurX = width / 2 + Math.sin(time * 1.2) * (width * 0.3);
                    const aurY = height / 2 + Math.cos(time * 0.8) * (height * 0.2);
                    const aurG = c.createRadialGradient(aurX, aurY, 20, width/2, height/2, Math.max(width, height) * 0.75);
                    aurG.addColorStop(0, `hsla(${aHue1}, 100%, 65%, 0.85)`);
                    aurG.addColorStop(0.5, `hsla(${aHue2}, 100%, 45%, 0.5)`);
                    aurG.addColorStop(1, 'rgba(0, 20, 10, 0)');
                    c.fillStyle = aurG; c.fillRect(0, 0, width, height);
                    break;

                case 'chroma-shift':
                    const baseHueH = (color * 110) % 360;
                    const gradH = c.createRadialGradient(width * 0.5 + Math.sin(time * 2) * (width * 0.3), height * 0.5 + Math.cos(time * 2) * (height * 0.3), 10, width/2, height/2, Math.max(width, height));
                    gradH.addColorStop(0, `hsl(${baseHueH}, 100%, 65%)`);
                    gradH.addColorStop(0.5, `hsl(${(baseHueH + 120) % 360}, 100%, 50%)`);
                    gradH.addColorStop(1, `hsl(${(baseHueH + 240) % 360}, 100%, 35%)`);
                    c.fillStyle = gradH; c.fillRect(0, 0, width, height);
                    break;

                case 'rainbow-wave':
                    const angle = time * 0.5;
                    const gradW = c.createLinearGradient(width/2 + Math.cos(angle)*width, height/2 + Math.sin(angle)*height, width/2 - Math.cos(angle)*width, height/2 - Math.sin(angle)*height);
                    for (let i = 0; i <= 10; i++) gradW.addColorStop(i/10, `hsl(${((color * 60) + i * 36) % 360}, 100%, 55%)`);
                    c.fillStyle = gradW; c.fillRect(0, 0, width, height);
                    break;

                case 'spiral-wave':
                    const cx = width / 2;
                    const cy = height / 2;
                    const maxR = Math.max(width, height) * 0.7;
                    const spiralGrad = c.createRadialGradient(cx, cy, 0, cx, cy, maxR);
                    const sHue = (color * 75) % 360;
                    spiralGrad.addColorStop(0, `hsl(${sHue}, 100%, 70%)`);
                    spiralGrad.addColorStop(0.4, `hsl(${(sHue + 90) % 360}, 100%, 55%)`);
                    spiralGrad.addColorStop(0.8, `hsl(${(sHue + 180) % 360}, 100%, 40%)`);
                    spiralGrad.addColorStop(1, '#000000');
                    c.fillStyle = spiralGrad; c.fillRect(0, 0, width, height);
                    break;

                case 'cascading-rainbow':
                    const gradC = c.createLinearGradient(0, 0, width * 0.5, height);
                    for (let i = 0; i <= 10; i++) gradC.addColorStop(i/10, `hsl(${((color * 80) + i * 36) % 360}, 100%, 55%)`);
                    c.fillStyle = gradC; c.fillRect(0, 0, width, height);
                    break;

                case 'chroma-breathing':
                    const breathVal = Math.sin(color * 2);
                    const bLum = Math.max(0, breathVal);


                    const bGrad = c.createRadialGradient(width/2, height/2, 10, width/2, height/2, Math.max(width, height) * 0.7);
                    bGrad.addColorStop(0, `hsla(${currentBreathHue}, 100%, ${65 * bLum}%, 1)`);
                    bGrad.addColorStop(1, `hsla(${currentBreathHue}, 100%, ${10 * bLum}%, 1)`);
                    c.fillStyle = bGrad; c.fillRect(0, 0, width, height);
                    break;

                case 'logi-lightsync':
                    const logiHue = (color * 60) % 360;
                    const logiG = c.createLinearGradient(0, 0, width, height);
                    logiG.addColorStop(0, `hsl(${logiHue}, 100%, 50%)`);
                    logiG.addColorStop(1, `hsl(${(logiHue + 60) % 360}, 100%, 40%)`);
                    c.fillStyle = logiG; c.fillRect(0, 0, width, height);
                    break;

                case 'msi-mystic':
                    const mGrad = c.createRadialGradient(width/2, height/2, 20, width/2, height/2, Math.max(width, height)*0.6);
                    const mHue = (color * 50) % 360;
                    mGrad.addColorStop(0, `hsl(${mHue}, 100%, 65%)`);
                    mGrad.addColorStop(0.5, `hsl(${(mHue + 180) % 360}, 100%, 45%)`);
                    mGrad.addColorStop(1, '#000000');
                    c.fillStyle = mGrad; c.fillRect(0, 0, width, height);
                    break;

                case 'nzxt-cam':
                    const nzHue = (color * 65) % 360;
                    const nzGrad = c.createLinearGradient(0, height, width, 0);
                    nzGrad.addColorStop(0, `hsl(${nzHue}, 100%, 60%)`);
                    nzGrad.addColorStop(1, `hsl(${(nzHue + 90) % 360}, 100%, 50%)`);
                    c.fillStyle = nzGrad; c.fillRect(0, 0, width, height);
                    break;

                case 'breath-spectrum':
                    const bsVal = Math.sin(color * 1.8) * 0.5 + 0.5;
                    const bsHue = (color * 50) % 360;
                    const bsGrad = c.createRadialGradient(width/2, height/2, 0, width/2, height/2, Math.max(width, height)*0.75);
                    bsGrad.addColorStop(0, `hsl(${bsHue}, 100%, ${70 * bsVal}%)`);
                    bsGrad.addColorStop(0.5, `hsl(${(bsHue + 60) % 360}, 100%, ${45 * bsVal}%)`);
                    bsGrad.addColorStop(1, `hsl(${(bsHue + 120) % 360}, 100%, ${15 * bsVal}%)`);
                    c.fillStyle = bsGrad; c.fillRect(0, 0, width, height);
                    break;
            }
        }

return { draw };
})();
