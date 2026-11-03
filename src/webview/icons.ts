// Icons from the file icon theme, which the extension reads and sends with every update.
import { span } from './dom.ts'
import type { FileIcon, IconFont } from '../types/shared.ts'

// The file icon theme's fonts that are added to the page already.
const loadedFonts = new Set<string>()

/** Adds the theme's fonts to the page, once each. */
export function loadFonts(fonts: readonly IconFont[]): void {
	for (const font of fonts) {
		const { family, src, weight, style } = font

		if (!loadedFonts.has(family)) {
			loadedFonts.add(family)
			document.fonts.add(new FontFace(family, src, { weight, style }))
		}
	}
}

/** An icon from the file icon theme: a character in one of its fonts, or an image. */
export function fileIcon(icon: FileIcon): HTMLSpanElement {
	const element = span('icon file-icon')

	if (icon.type === 'image') {
		element.classList.toggle('mask', icon.mask)
		element.style.setProperty(icon.mask ? 'mask-image' : 'background-image', `url("${icon.uri}")`)
		return element
	}

	element.textContent = icon.character
	element.style.setProperty('font-family', `"${icon.family}"`)

	const styles = {
		color: icon.color,
		'font-size': icon.size,
		'font-weight': icon.weight,
		'font-style': icon.style,
	}

	for (const [property, value] of Object.entries(styles)) {
		if (value) {
			element.style.setProperty(property, value)
		}
	}

	return element
}
