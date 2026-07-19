function rg(props) {
	const [entries, setEntries] = v.useState([]);
	const [activeFilters, setActiveFilters] = v.useState(/* @__PURE__ */ new Set());
	const [search, setSearch] = v.useState("");
	const dropdownRef = v.useRef(null);
	const overlayRef = v.useRef(null);
	v.useRef(null);
	const [showClear, setShowClear] = v.useState(false);
	const [showExport, setShowExport] = v.useState(false);
	const [hoveredIdx, setHoveredIdx] = v.useState(null);
	const [autoScroll, setAutoScroll] = v.useState(true);
	const [currentMatch, setCurrentMatch] = v.useState(0);
	const bodyRef = v.useRef(null);
	v.useEffect(() => {
		if (autoScroll && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
	}, [entries, autoScroll]);
	const levelColors = {
		error: {
			bg: "var(--q-log-error-bg)",
			text: "var(--q-log-error-text)",
			tag: "var(--q-log-error-tag)",
			pill: "var(--q-accent-danger)"
		},
		warn: {
			bg: "var(--q-log-warn-bg)",
			text: "var(--q-log-warn-text)",
			tag: "var(--q-log-warn-tag)",
			pill: "var(--q-accent-warning)"
		},
		ui: {
			bg: "var(--q-log-ui-bg)",
			text: "var(--q-log-ui-text)",
			tag: "var(--q-log-ui-tag)",
			pill: "var(--q-accent-info)"
		},
		success: {
			bg: "var(--q-log-success-bg)",
			text: "var(--q-log-success-text)",
			tag: "var(--q-log-success-tag)",
			pill: "var(--q-accent-success)"
		},
		bridge: {
			bg: "var(--q-log-bridge-bg)",
			text: "var(--q-log-bridge-text)",
			tag: "var(--q-log-bridge-tag)",
			pill: "var(--q-text)"
		},
		renderer: {
			bg: "var(--q-log-renderer-bg)",
			text: "var(--q-log-renderer-text)",
			tag: "var(--q-log-renderer-tag)",
			pill: "var(--q-text-secondary)"
		},
		info: {
			bg: "var(--q-log-info-bg)",
			text: "var(--q-log-info-text)",
			tag: "var(--q-log-info-tag)",
			pill: "var(--q-text-tertiary)"
		}
	};
	const moreFilters = [
		"success",
		"bridge",
		"renderer",
		"info"
	];
	const months = [
		"january",
		"february",
		"march",
		"april",
		"may",
		"june",
		"july",
		"august",
		"september",
		"october",
		"november",
		"december"
	];
	function deriveLevel(tag) {
		if (tag.startsWith("error") || tag.includes("error")) return "error";
		if (tag.startsWith("warn") || tag.startsWith("warning") || tag === "retrying") return "warn";
		if (tag.startsWith("success")) return "success";
		if (tag.startsWith("ui-") || tag.startsWith("ui:") || tag.includes("ui-click") || tag.includes("ui-nav") || tag.includes("ui-keyboard") || tag.includes("ui-panel")) return "ui";
		if (tag.startsWith("bridge:") || tag.startsWith("bridge-") || tag.startsWith("full-state-") || tag.startsWith("get_") || tag.startsWith("ws:") || tag.startsWith("send:") || tag.startsWith("stream:") || tag.startsWith("history:") || tag.startsWith("session:")) return "bridge";
		if (tag.startsWith("renderer:") || tag.startsWith("renderer-")) return "renderer";
		return "info";
	}
	function formatPayload(data) {
		if (data == null) return "";
		if (typeof data === "string") return data;
		if (typeof data !== "object") return String(data);
		try {
			return JSON.stringify(data, null, 2);
		} catch {
			return String(data);
		}
	}
	function fmtDateShort(ts) {
		const d = new Date(ts);
		return d.getDate() + " " + months[d.getMonth()] + " " + d.getFullYear();
	}
	function fmtTimeShort(ts) {
		const d = new Date(ts);
		return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0") + ":" + String(d.getSeconds()).padStart(2, "0");
	}
	function fmtTimestampFull(ts) {
		return fmtDateShort(ts) + ", " + fmtTimeShort(ts);
	}
	const filtered = entries.filter((e) => {
		const level = deriveLevel(e.tag);
		if (activeFilters.size > 0 && !activeFilters.has(level)) return false;
		if (search) {
			const p = formatPayload(e.data);
			if (!(fmtDateShort(e.ts) + " " + fmtTimeShort(e.ts) + " " + e.tag + " " + p).toLowerCase().includes(search.toLowerCase())) return false;
		}
		return true;
	});
	const searchMatches = [];
	if (search) {
		const q = search.toLowerCase();
		filtered.forEach((e, i) => {
			const p = formatPayload(e.data);
			const f = (fmtDateShort(e.ts) + " " + fmtTimeShort(e.ts) + " " + e.tag + " " + p).toLowerCase();
			let idx = 0;
			while ((idx = f.indexOf(q, idx)) !== -1) {
				searchMatches.push({ entryIdx: i });
				idx += q.length;
			}
		});
	}
	function toggleFilter(level) {
		setActiveFilters((prev) => {
			const n = new Set(prev);
			if (n.has(level)) n.delete(level);
			else n.add(level);
			return n;
		});
	}
	const panelStyle = {
		backgroundColor: "var(--q-bg-panel)",
		borderRadius: "var(--radius-lg)",
		boxShadow: "var(--shadow-floating)",
		padding: "8px",
		minHeight: "var(--spacing-header-min)",
		display: "flex",
		alignItems: "center"
	};
	function IconBtn({ icon: Icon, onClick }) {
		return (0,z.jsx)("button", {
			onClick,
			onMouseEnter: (e) => {
				e.currentTarget.style.backgroundColor = "var(--q-hover)";
				e.currentTarget.style.color = "var(--q-text)";
			},
			onMouseLeave: (e) => {
				e.currentTarget.style.backgroundColor = "transparent";
				e.currentTarget.style.color = "var(--q-text-secondary)";
			},
			style: {
				width: "32px",
				height: "32px",
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				borderRadius: "var(--radius-md)",
				border: "none",
				cursor: "pointer",
				backgroundColor: "transparent",
				color: "var(--q-text-secondary)",
				flexShrink: 0,
				padding: "0",
				transition: "background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms cubic-bezier(0.16, 1, 0.3, 1)"
			},
			children: (0,z.jsx)(Icon, { size: 20 })
		});
	}
	function FilterPill({ level }) {
		const isActive = activeFilters.has(level);
		const color = levelColors[level]?.pill || "var(--q-text-tertiary)";
		return (0,z.jsx)("button", {
			onClick: () => toggleFilter(level),
			style: {
				height: "32px",
				padding: "0 8px",
				minWidth: "45px",
				borderRadius: "var(--radius-md)",
				cursor: "pointer",
				backgroundColor: isActive ? color : "transparent",
				border: "1px solid " + color,
				color: isActive ? "var(--q-bg)" : color,
				fontSize: "12px",
				fontFamily: "var(--font-interface)",
				fontWeight: 500,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				transition: "background-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease"
			},
			children: level
		});
	}
	function HeaderBtn({ label, icon, onClick, active }) {
		function applyStyle(el, isGreen) {
			el.style.borderColor = isGreen ? "var(--q-accent-success)" : "var(--q-border)";
			el.style.color = isGreen ? "var(--q-accent-success)" : "var(--q-text-secondary)";
		}
		return (0,z.jsxs)("button", {
			onClick,
			onMouseEnter: (e) => applyStyle(e.currentTarget, true),
			onMouseLeave: (e) => applyStyle(e.currentTarget, active || false),
			style: {
				display: "flex",
				alignItems: "center",
				gap: "6px",
				padding: "0 8px",
				height: "32px",
				borderRadius: "var(--radius-md)",
				border: "1px solid " + (active ? "var(--q-accent-success)" : "var(--q-border)"),
				cursor: "pointer",
				backgroundColor: "transparent",
				color: active ? "var(--q-accent-success)" : "var(--q-text-secondary)",
				fontSize: "12px",
				fontFamily: "var(--font-interface)",
				transition: "border-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease"
			},
			children: [icon, label]
		});
	}
	return (0,z.jsxs)("div", {
		className: "h-full flex flex-col",
		style: {
			maxWidth: "var(--spacing-chat-max)",
			margin: "0 auto",
			width: "100%"
		},
		children: [
			(0,z.jsxs)("div", {
				style: {
					marginBottom: "8px",
					flexShrink: 0,
					display: "flex",
					alignItems: "center"
				},
				children: [
					(0,z.jsx)("div", {
						style: panelStyle,
						children: (0,z.jsx)(IconBtn, {
							icon: Et,
							onClick: () => props.onSelectPanel("home")
						})
					}),
					(0,z.jsx)("div", { style: {
						width: "8px",
						flexShrink: 0
					} }),
					(0,z.jsxs)("div", {
						style: {
							...panelStyle,
							flex: 1
						},
						children: [
							(0,z.jsx)("div", { style: {
								width: "8px",
								flexShrink: 0
							} }),
							(0,z.jsx)(It, {
								size: 18,
								style: {
									color: "var(--q-text-secondary)",
									flexShrink: 0
								}
							}),
							(0,z.jsx)("div", { style: {
								width: "12px",
								flexShrink: 0
							} }),
							(0,z.jsx)("span", {
								style: {
									color: "var(--q-text)",
									fontSize: "16px",
									fontWeight: 600,
									fontFamily: "var(--font-interface)"
								},
								children: "Log"
							}),
							(0,z.jsx)("div", { style: {
								width: "8px",
								flexShrink: 0
							} }),
							(0,z.jsx)("span", {
								style: {
									color: "var(--q-text-tertiary)",
									fontSize: "12px",
									fontFamily: "var(--font-interface)"
								},
								children: "(" + filtered.length + ")"
							}),
							(0,z.jsx)("div", { style: {
								width: "8px",
								flexShrink: 0
							} }),
							(0,z.jsx)(FilterPill, { level: "error" }),
							(0,z.jsx)("div", { style: {
								width: "8px",
								flexShrink: 0
							} }),
							(0,z.jsx)(FilterPill, { level: "warn" }),
							(0,z.jsx)("div", { style: {
								width: "8px",
								flexShrink: 0
							} }),
							(0,z.jsx)(FilterPill, { level: "ui" }),
							(0,z.jsx)("div", { style: {
								width: "8px",
								flexShrink: 0
							} }),
							(0,z.jsxs)("div", {
								style: {
									position: "relative",
									display: "flex",
									alignItems: "center"
								},
								children: [
									(0,z.jsxs)("button", {
										onClick: (e) => {
											const btn = e.currentTarget;
											const isOpen = btn.dataset.open === "1";
											if (dropdownRef.current) dropdownRef.current.style.display = isOpen ? "none" : "flex";
											if (overlayRef.current) overlayRef.current.style.display = isOpen ? "none" : "block";
											const arrow = btn.querySelector("svg");
											if (arrow) arrow.style.transform = isOpen ? "rotate(0deg)" : "rotate(90deg)";
											btn.dataset.open = isOpen ? "0" : "1";
											btn.style.borderColor = isOpen ? "var(--q-border)" : "var(--q-accent-success)";
											btn.style.color = isOpen ? "var(--q-text-secondary)" : "var(--q-accent-success)";
										},
										onMouseEnter: (e) => {
											e.currentTarget.style.borderColor = "var(--q-accent-success)";
											e.currentTarget.style.color = "var(--q-accent-success)";
										},
										onMouseLeave: (e) => {
											const btn = e.currentTarget;
											const isOpen = btn.dataset.open === "1";
											btn.style.borderColor = isOpen ? "var(--q-accent-success)" : "var(--q-border)";
											btn.style.color = isOpen ? "var(--q-accent-success)" : "var(--q-text-secondary)";
										},
										style: {
											display: "flex",
											alignItems: "center",
											gap: "6px",
											padding: "0 8px",
											height: "32px",
											borderRadius: "var(--radius-md)",
											border: "1px solid var(--q-border)",
											cursor: "pointer",
											backgroundColor: "transparent",
											color: "var(--q-text-secondary)",
											fontSize: "12px",
											fontFamily: "var(--font-interface)",
											transition: "border-color 120ms cubic-bezier(0.16, 1, 0.3, 1), color 120ms ease"
										},
										children: [(0,z.jsx)(un, {
											size: 14,
											style: { transition: "transform 120ms ease" }
										}), "More"]
									}),
									(0,z.jsx)("div", {
										ref: overlayRef,
										style: {
											position: "fixed",
											inset: 0,
											zIndex: 40,
											backgroundColor: "transparent",
											display: "none"
										},
										onClick: () => {
											if (dropdownRef.current) dropdownRef.current.style.display = "none";
											if (overlayRef.current) overlayRef.current.style.display = "none";
											const moreBtn = dropdownRef.current?.parentElement?.querySelector("button");
											if (moreBtn) {
												moreBtn.dataset.open = "0";
												moreBtn.style.borderColor = "var(--q-border)";
												moreBtn.style.color = "var(--q-text-secondary)";
												const arrow = moreBtn.querySelector("svg");
												if (arrow) arrow.style.transform = "rotate(0deg)";
											}
										}
									}),
									(0,z.jsx)("div", {
										ref: dropdownRef,
										style: {
											position: "absolute",
											top: "calc(100% + 8px)",
											left: "0",
											zIndex: 50,
											backgroundColor: "var(--q-bg-panel)",
											borderRadius: "var(--radius-md)",
											boxShadow: "var(--shadow-modal)",
											border: "1px solid var(--q-border)",
											padding: "4px",
											display: "none",
											flexDirection: "column",
											gap: "4px"
										},
										children: moreFilters.map((level) => (0,z.jsx)(FilterPill, {
											key: level,
											level
										}))
									})
								]
							}),
							(0,z.jsx)("div", { style: {
								width: "8px",
								flexShrink: 0
							} }),
							(0,z.jsx)("span", { style: { flex: 1 } }),
							(0,z.jsx)(HeaderBtn, {
								label: "export all",
								icon: (0,z.jsx)(Ut, { size: 14 }),
								onClick: () => setShowExport(true)
							}),
							(0,z.jsx)("div", { style: {
								width: "4px",
								flexShrink: 0
							} }),
							(0,z.jsx)(HeaderBtn, {
								label: "copy",
								icon: (0,z.jsx)(Vt, { size: 14 }),
								onClick: () => {}
							}),
							(0,z.jsx)("div", { style: {
								width: "4px",
								flexShrink: 0
							} }),
							(0,z.jsx)(HeaderBtn, {
								label: "refresh",
								icon: (0,z.jsx)(Gt, { size: 14 }),
								onClick: () => {}
							}),
							(0,z.jsx)("div", { style: {
								width: "4px",
								flexShrink: 0
							} }),
							(0,z.jsx)(HeaderBtn, {
								label: "clear",
								icon: (0,z.jsx)(Ht, { size: 14 }),
								onClick: () => setShowClear(true)
							})
						]
					})
				]
			}),
			(0,z.jsx)("div", {
				ref: bodyRef,
				style: {
					flex: 1,
					overflowY: "auto",
					padding: "1px 16px 8px 16px"
				},
				children: filtered.length === 0 ? (0,z.jsx)("div", {
					style: {
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						height: "100%",
						color: "var(--q-text-tertiary)",
						fontSize: "14px",
						fontFamily: "var(--font-interface)"
					},
					children: "log vuoto"
				}) : filtered.map((e, i) => {
					const level = deriveLevel(e.tag);
					const colors = levelColors[level] || levelColors.info;
					const payload = formatPayload(e.data);
					const isHovered = hoveredIdx === i;
					return (0,z.jsxs)("div", {
						key: i,
						onMouseEnter: () => setHoveredIdx(i),
						onMouseLeave: () => setHoveredIdx(null),
						style: {
							width: "100%",
							padding: "16px",
							marginBottom: "8px",
							borderRadius: "var(--radius-lg)",
							backgroundColor: colors.bg,
							boxShadow: "var(--shadow-floating)",
							position: "relative"
						},
						children: [
							(0,z.jsxs)("div", {
								style: {
									display: "flex",
									alignItems: "center",
									gap: "8px"
								},
								children: [(0,z.jsx)("span", {
									style: {
										color: "var(--q-text-tertiary)",
										fontSize: "12px",
										fontFamily: "var(--font-code)",
										flexShrink: 0
									},
									children: fmtTimestampFull(e.ts)
								}), (0,z.jsx)("span", {
									style: {
										color: colors.tag,
										fontSize: "12px",
										fontFamily: "var(--font-code)",
										fontWeight: 600,
										flexShrink: 0
									},
									children: "[" + e.tag + "]"
								})]
							}),
							payload ? (0,z.jsx)("div", {
								style: {
									marginTop: "4px",
									color: colors.text,
									fontSize: "14px",
									fontFamily: "var(--font-interface)",
									lineHeight: 1.65,
									whiteSpace: "pre-wrap",
									wordBreak: "break-word"
								},
								children: payload
							}) : null,
							(0,z.jsx)("button", {
								onClick: (ev) => {
									ev.stopPropagation();
									navigator.clipboard.writeText(formatPayload(e.data));
								},
								style: {
									position: "absolute",
									top: "8px",
									right: "8px",
									background: "none",
									border: "none",
									cursor: "pointer",
									padding: "6px",
									borderRadius: "var(--radius-md)",
									color: "var(--q-text)",
									display: "flex",
									opacity: isHovered ? 1 : 0,
									transition: "opacity 150ms ease"
								},
								children: (0,z.jsx)(Vt, { size: 16 })
							})
						]
					});
				})
			}),
			(0,z.jsxs)("div", {
				style: {
					marginTop: "8px",
					flexShrink: 0,
					...panelStyle
				},
				children: [
					(0,z.jsx)("div", { style: {
						width: "12px",
						flexShrink: 0
					} }),
					(0,z.jsx)(Lt, {
						size: 16,
						style: {
							color: "var(--q-text-tertiary)",
							flexShrink: 0
						}
					}),
					(0,z.jsx)("div", { style: {
						width: "8px",
						flexShrink: 0
					} }),
					(0,z.jsx)("input", {
						type: "text",
						placeholder: "Search in logs...",
						value: search,
						onChange: (e) => setSearch(e.target.value),
						style: {
							flex: 1,
							backgroundColor: "transparent",
							border: "none",
							outline: "none",
							color: "var(--q-text)",
							fontSize: "14px",
							fontFamily: "var(--font-interface)",
							padding: "0",
							margin: "0"
						}
					}),
					(0,z.jsx)("button", {
						onClick: () => setSearch(""),
						style: {
							background: "none",
							border: "none",
							cursor: search ? "pointer" : "default",
							padding: "8px",
							color: search ? "var(--q-text-secondary)" : "var(--q-text-tertiary)",
							fontSize: "14px",
							opacity: search ? 1 : .3
						},
						children: "✕"
					}),
					(0,z.jsx)("div", { style: {
						width: "8px",
						flexShrink: 0
					} }),
					(0,z.jsx)("span", {
						style: {
							color: "var(--q-text-tertiary)",
							fontSize: "12px",
							fontFamily: "var(--font-code)",
							opacity: !search || searchMatches.length === 0 ? .3 : 1
						},
						children: search ? searchMatches.length === 0 ? "0/0" : currentMatch + 1 + "/" + searchMatches.length : "0/0"
					}),
					(0,z.jsx)("div", { style: {
						width: "8px",
						flexShrink: 0
					} }),
					(0,z.jsx)("button", {
						onClick: () => searchMatches.length > 0 && setCurrentMatch((p) => (p - 1 + searchMatches.length) % searchMatches.length),
						style: {
							background: "none",
							border: "none",
							cursor: "pointer",
							padding: "0px",
							color: searchMatches.length > 0 ? "var(--q-text-secondary)" : "var(--q-text-tertiary)",
							opacity: searchMatches.length > 0 ? 1 : .3,
							display: "flex"
						},
						children: (0,z.jsx)(cn, { size: 16 })
					}),
					(0,z.jsx)("button", {
						onClick: () => searchMatches.length > 0 && setCurrentMatch((p) => (p + 1) % searchMatches.length),
						style: {
							background: "none",
							border: "none",
							cursor: "pointer",
							padding: "0px",
							color: searchMatches.length > 0 ? "var(--q-text-secondary)" : "var(--q-text-tertiary)",
							opacity: searchMatches.length > 0 ? 1 : .3,
							display: "flex"
						},
						children: (0,z.jsx)(sn, { size: 16 })
					})
				]
			}),
			showExport && (0,z.jsx)("div", {
				style: {
					position: "fixed",
					inset: 0,
					zIndex: 100,
					backgroundColor: "var(--q-overlay)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center"
				},
				onClick: () => setShowExport(false),
				children: (0,z.jsxs)("div", {
					style: {
						backgroundColor: "var(--q-bg-elevated)",
						borderRadius: "var(--radius-xl)",
						boxShadow: "var(--shadow-modal)",
						animation: "modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)",
						padding: "24px",
						maxWidth: "400px",
						width: "90%"
					},
					onClick: (e) => e.stopPropagation(),
					children: [
						(0,z.jsx)("div", {
							style: {
								color: "var(--q-text)",
								fontSize: "16px",
								fontFamily: "var(--font-interface)",
								marginBottom: "8px"
							},
							children: "Export log entries?"
						}),
						(0,z.jsxs)("div", {
							style: {
								color: "var(--q-text-tertiary)",
								fontSize: "13px",
								fontFamily: "var(--font-interface)",
								marginBottom: "20px"
							},
							children: [filtered.length, " entries will be exported to clipboard as markdown."]
						}),
						(0,z.jsxs)("div", {
							style: {
								display: "flex",
								justifyContent: "flex-end",
								alignItems: "center"
							},
							children: [
								(0,z.jsx)("button", {
									className: "q-press",
									onClick: () => setShowExport(false),
									style: {
										padding: "8px 16px",
										borderRadius: "var(--radius-md)",
										border: "none",
										cursor: "pointer",
										backgroundColor: "transparent",
										color: "var(--q-accent-danger)",
										fontSize: "15px",
										fontFamily: "var(--font-interface)"
									},
									children: "Cancel"
								}),
								(0,z.jsx)("div", { style: { width: "8px" } }),
								(0,z.jsx)("button", {
									className: "q-press",
									onClick: () => {
										const md = filtered.map((e) => "### [" + deriveLevel(e.tag) + "] " + fmtTimestampFull(e.ts) + "\n**Tag:** " + e.tag + "\n\n" + formatPayload(e.data) + "\n").join("\n---\n\n");
										navigator.clipboard.writeText(md);
										setShowExport(false);
									},
									style: {
										padding: "8px 16px",
										borderRadius: "var(--radius-lg)",
										border: "none",
										cursor: "pointer",
										backgroundColor: "var(--q-accent-success)",
										color: "var(--q-bg)",
										fontSize: "15px",
										fontWeight: 500,
										fontFamily: "var(--font-interface)"
									},
									children: "Export"
								})
							]
						})
					]
				})
			}),
			showClear && (0,z.jsx)("div", {
				style: {
					position: "fixed",
					inset: 0,
					zIndex: 100,
					backgroundColor: "var(--q-overlay)",
					display: "flex",
					alignItems: "center",
					justifyContent: "center"
				},
				onClick: () => setShowClear(false),
				children: (0,z.jsxs)("div", {
					style: {
						backgroundColor: "var(--q-bg-elevated)",
						borderRadius: "var(--radius-xl)",
						boxShadow: "var(--shadow-modal)",
						animation: "modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)",
						padding: "24px",
						maxWidth: "400px",
						width: "90%"
					},
					onClick: (e) => e.stopPropagation(),
					children: [
						(0,z.jsx)("div", {
							style: {
								color: "var(--q-text)",
								fontSize: "16px",
								fontFamily: "var(--font-interface)",
								marginBottom: "8px"
							},
							children: "Clear all log entries?"
						}),
						(0,z.jsxs)("div", {
							style: {
								color: "var(--q-text-tertiary)",
								fontSize: "13px",
								fontFamily: "var(--font-interface)",
								marginBottom: "20px"
							},
							children: [entries.length, " entries will be removed."]
						}),
						(0,z.jsxs)("div", {
							style: {
								display: "flex",
								justifyContent: "flex-end",
								alignItems: "center"
							},
							children: [
								(0,z.jsx)("button", {
									className: "q-press",
									onClick: () => setShowClear(false),
									style: {
										padding: "8px 16px",
										borderRadius: "var(--radius-md)",
										border: "none",
										cursor: "pointer",
										backgroundColor: "transparent",
										color: "var(--q-accent-danger)",
										fontSize: "15px",
										fontFamily: "var(--font-interface)"
									},
									children: "Cancel"
								}),
								(0,z.jsx)("div", { style: { width: "8px" } }),
								(0,z.jsx)("button", {
									className: "q-press",
									onClick: () => {
										setEntries([]);
										setShowClear(false);
									},
									style: {
										padding: "8px 16px",
										borderRadius: "var(--radius-lg)",
										border: "none",
										cursor: "pointer",
										backgroundColor: "var(--q-accent-success)",
										color: "var(--q-bg)",
										fontSize: "15px",
										fontWeight: 500,
										fontFamily: "var(--font-interface)"
									},
									children: "Clear"
								})
							]
						})
					]
				})
			})
		]
	});
}function ig(){let[e,t]=(0,v.useState)(null);if((0,v.useEffect)(()=>{let e=e=>{let n=e.target;(n.tagName===`INPUT`||n.tagName===`TEXTAREA`||n.isContentEditable)&&(e.preventDefault(),t({x:e.clientX,y:e.clientY,target:e.target}))};return document.addEventListener(`contextmenu`,e),()=>document.removeEventListener(`contextmenu`,e)},[]),!e)return null;let n=Math.min(e.x,window.innerWidth-160),r=Math.min(e.y,window.innerHeight-140);return(0,z.jsxs)(z.Fragment,{children:[(0,z.jsx)(`div`,{style:{position:`fixed`,inset:0,zIndex:9998,backgroundColor:`transparent`},onClick:()=>t(null),onContextMenu:e=>{e.preventDefault(),t(null)}}),(0,z.jsxs)(`div`,{style:{position:`fixed`,left:n,top:r,zIndex:9999,backgroundColor:`var(--q-bg-panel)`,borderRadius:`var(--radius-md)`,boxShadow:`var(--shadow-modal)`,animation:`modalEnter 250ms cubic-bezier(0.16, 1, 0.3, 1)`,border:`1px solid var(--q-border)`,padding:`4px 0`,minWidth:`140px`},children:[(0,z.jsx)(ag,{label:`Copy`,onClick:()=>{document.execCommand(`copy`),t(null)}}),(0,z.jsx)(ag,{label:`Paste`,onClick:()=>{navigator.clipboard.readText().then(n=>{let r=e.target;if(r&&`value`in r){let e=r.selectionStart||0,t=r.selectionEnd||0;r.value=r.value.substring(0,e)+n+r.value.substring(t),r.setSelectionRange(e+n.length,e+n.length),r.dispatchEvent(new Event(`input`,{bubbles:!0}))}t(null)}).catch(()=>t(null))}}),(0,z.jsx)(ag,{label:`Cut`,onClick:()=>{document.execCommand(`cut`),t(null)}})]})]})}function ag({label:e,onClick:t}){let[n,r]=(0,v.useState)(!1);return(0,z.jsx)(`button`,{onClick:t,onMouseEnter:()=>r(!0),onMouseLeave:()=>r(!1),style:{display:`flex`,alignItems:`center`,width:`100%`,padding:`8px 12px`,border:`none`,cursor:`pointer`,backgroundColor:n?`var(--q-hover)`:`transparent`,color:`var(--q-text)`,fontSize:`14px`,fontFamily:`var(--font-interface)`,textAlign:`left`,transform:n?`scale(1.02)`:`scale(1)`,transition:`transform 120ms cubic-bezier(0.16, 1, 0.3, 1)`},children:e})}var og=new Date,sg=e=>new Date(og.getTime()-e*6e4).toISOString();sg(45),sg(44),sg(40),sg(39),sg(35),sg(34),sg(30),sg(29),sg(25),sg(24),sg(20),sg(19),sg(15),sg(14),sg(10),sg(9),sg(5),sg(60),sg(60),sg(120),sg(120),sg(600);var cg=[{id:`comfort`,name:`Comfort`,bg:`#08080B`,bgPanel:`#0F0F13`,bgBubbleUser:`#1A1A20`,text:`#E8E8EC`},{id:`midnight`,name:`Midnight`,bg:`#060608`,bgPanel:`#0C0C10`,bgBubbleUser:`#16161A`,text:`#E8E8EC`},{id:`forest`,name:`Forest`,bg:`#08080A`,bgPanel:`#0E0E10`,bgBubbleUser:`#18181A`,text:`#E8E8EC`},{id:`warm`,name:`Warm`,bg:`#0A0A0A`,bgPanel:`#101010`,bgBubbleUser:`#1A1A1A`,text:`#E8E8EC`},{id:`eclipse`,name:`Eclipse`,bg:`#040406`,bgPanel:`#0A0A0C`,bgBubbleUser:`#141416`,text:`#E8E8EC`},{id:`graphite`,name:`Graphite`,bg:`#0C0C0E`,bgPanel:`#121214`,bgBubbleUser:`#1E1E20`,text:`#E8E8EC`},{id:`mist`,name:`Mist`,bg:`#141416`,bgPanel:`#1A1A1C`,bgBubbleUser:`#262628`,text:`#E8E8EC`}],lg=1;function ug(e=`ws://127.0.0.1:9182`){let t=(0,v.useRef)(null),[n,r]=(0,v.useState)(!1),[i,a]=(0,v.useState)(null),o=(0,v.useRef)(new Map),s=(0,v.useRef)(new Map),[c,l]=(0,v.useState)([]);return(0,v.useEffect)(()=>{let n,i,c=!1,u=()=>{c||(n=new WebSocket(e),t.current=n,n.onopen=()=>{r(!0),a(null)},n.onmessage=e=>{let t;try{t=JSON.parse(e.data)}catch{return}if(t.id!==void 0){let e=o.current.get(t.id);e&&(o.current.delete(t.id),t.error?e.reject(t.error):e.resolve(t.result))}if(t.method&&t.id===void 0){let e=s.current.get(t.method);if(e)for(let n of e)n(t.params);l(e=>[...e.slice(-99),t])}},n.onerror=()=>{a(`WebSocket connection error`)},n.onclose=()=>{r(!1),c||(i=setTimeout(u,2e3))})};return u(),()=>{c=!0,clearTimeout(i),n&&n.close()}},[e]),{call:(0,v.useCallback)((e,n={})=>new Promise((r,i)=>{if(!t.current||t.current.readyState!==WebSocket.OPEN){i(Error(`WebSocket not connected`));return}let a=lg++;o.current.set(a,{resolve:r,reject:i}),t.current.send(JSON.stringify({jsonrpc:`2.0`,method:e,params:n,id:a})),setTimeout(()=>{o.current.has(a)&&(o.current.delete(a),i(Error(`RPC timeout: ${e}`)))},3e4)}),[]),notify:(0,v.useCallback)((e,n={})=>{t.current&&t.current.readyState===WebSocket.OPEN&&t.current.send(JSON.stringify({jsonrpc:`2.0`,method:e,params:n}))},[]),ready:n,error:i,events:c,subscribe:(0,v.useCallback)((e,t)=>(s.current.has(e)||s.current.set(e,new Set),s.current.get(e).add(t),()=>{s.current.get(e)?.delete(t)}),[])}}function dg(e=`ws://127.0.0.1:9182`){let{call:t,notify:n,ready:r,subscribe:i}=ug(e),[a,o]=(0,v.useState)(!0),[s,c]=(0,v.useState)([]),[l,u]=(0,v.useState)([]),[d,f]=(0,v.useState)([]),[p,m]=(0,v.useState)([]),[h,g]=(0,v.useState)(null),[_,y]=(0,v.useState)(!1),[b,x]=(0,v.useState)(``),[S,C]=(0,v.useState)(``),[w,T]=(0,v.useState)(0),[E,D]=(0,v.useState)(1e6),[O]=(0,v.useState)(null);return(0,v.useEffect)(()=>{if(!r)return;let e=!1;return console.log(`[useSidecarData] Sidecar connected, loading data...`),(async()=>{try{let n=await t(`listAgents`,{});if(!e&&n?.agents){console.log(`[useSidecarData] Got agents:`,n.agents.map(e=>e.name));let e=await Promise.all(n.agents.map(async e=>{let n=[];try{let r=await t(`listAgentFiles`,{id:e.id});r?.files&&(n=r.files.map(e=>e.name||e.path||e))}catch{console.log(`[useSidecarData] No files for`,e.id)}return{id:e.id,name:e.name,systemPrompt:e.prompt||``,model:e.model||``,thinking:e.thinking||`off`,skills:(e.skills||[]).map(e=>({name:e,source:`local`,installed:!0})),tools:(e.tools||[]).map(e=>({name:e,enabled:!0})),files:n,isDeletable:e.id!==`orchestrator`}}));u(e)}try{let n=await t(`listSessions`,{});!e&&n?.sessions&&(console.log(`[useSidecarData] Got sessions:`,n.sessions.length),c(n.sessions.map(e=>({id:e.sessionKey||e.id,title:e.title||`Untitled`,type:`chat`,updatedAt:e.updatedAt||new Date().toISOString(),messageCount:e.messageCount||0,agents:e.agents||[],unread:e.unread||!1}))))}catch{console.log(`[useSidecarData] No sessions loaded (might be empty)`)}try{let e=await t(`getModels`,{}),n=await t(`getProvidersConfig`,{}),r={};if(e?.models)for(let t of e.models){let e=t.provider||`unknown`;r[e]||(r[e]=[]),r[e].push({id:t.id,name:t.name||t.id,contextWindow:t.contextWindow})}let i=[];if(n?.providers)for(let[e,t]of Object.entries(n.providers))i.push({id:e,name:e,type:t.api||`ollama`,apiKeyStatus:t.apiKey||t.apiKeySet?`configured`:`missing`,models:r[e]||[],enabled:t.enabled!==!1}),delete r[e];for(let[e,t]of Object.entries(r))i.push({id:e,name:e,type:`unknown`,apiKeyStatus:`missing`,models:t,enabled:!0});console.log(`[useSidecarData] Got providers:`,i.length,`with`,i.reduce((e,t)=>e+t.models.length,0),`models`),f(i)}catch(e){console.log(`[useSidecarData] No providers loaded:`,e)}o(!1),console.log(`[useSidecarData] Data loaded successfully`)}catch(e){console.error(`[useSidecarData] Failed to load data:`,e),o(!1)}})(),()=>{e=!0}},[r,t]),(0,v.useEffect)(()=>{if(!r)return;let e=i(`ready`,()=>{console.log(`[useSidecarData] Sidecar ready notification`)}),t=i(`stream_event`,e=>{let{type:t,content:n,messageId:r}=e;console.log(`[useSidecarData] Stream event:`,t),t===`text`?(m(e=>{let t=e[e.length-1];return t&&t.role===`assistant`&&t.isStreaming?[...e.slice(0,-1),{...t,content:(t.content||``)+n}]:[...e,{id:r||`msg-${Date.now()}`,role:`assistant`,content:n,timestamp:new Date().toISOString(),isStreaming:!0}]}),x(`Writing`),C(`writing`)):t===`thinking`?(x(`Thinking`),C(`thinking`)):t===`toolCall`?(x(`Tool call`),C(`tool_call`)):t===`toolResult`?(x(`Tool result`),C(`tool_result`)):t===`delegation_start`?(x(`Delegating`),C(`delegation`)):t===`delegation_end`?(x(`Running`),C(`running`)):t===`error`?(x(`Failed`),C(`failed`),y(!1)):(t===`done`||t===`end`)&&(y(!1),x(``),C(``),m(e=>e.map(e=>e.isStreaming?{...e,isStreaming:!1}:e)))}),n=i(`compaction`,()=>{x(`Compacting`),C(`compacting`)}),a=i(`context_update`,e=>{e.tokens!==void 0&&T(e.tokens),e.window!==void 0&&D(e.window)});return()=>{e(),t(),n(),a()}},[r,i]),{connected:r,error:O,loading:a,sessions:s,agents:l,providers:d,messages:p,activeSessionId:h,isStreaming:_,statusLabel:b,statusKind:S,contextTokens:w,contextWindow:E,selectSession:(0,v.useCallback)(async e=>{if(r){g(e),m([]);try{let n=await t(`getHistory`,{sessionKey:e});n?.messages&&m(n.messages.map(e=>({id:e.id||`msg-${Math.random()}`,role:e.role,content:e.content,timestamp:e.timestamp||new Date().toISOString(),thinking:e.thinking,toolCalls:e.toolCalls,toolResults:e.toolResults,agentName:e.agentName,tokensIn:e.tokensIn,tokensOut:e.tokensOut,isCompacted:e.isCompacted})));let r=await t(`getContextUsage`,{sessionKey:e});r&&(T(r.tokens||0),D(r.window||1e6))}catch(e){console.error(`[useSidecarData] Failed to load session:`,e)}}},[r,t]),sendMessage:(0,v.useCallback)(async(e,n,i)=>{if(!r)return;let a={id:`msg-${Date.now()}`,role:`user`,content:e,timestamp:new Date().toISOString(),tokensIn:Math.ceil(e.length/4)};m(e=>[...e,a]),y(!0),x(`Thinking`),C(`thinking`);try{let r=await t(`sendMessage`,{sessionKey:n||h||``,text:e,agents:i||[]});r?.sessionKey&&!h&&g(r.sessionKey)}catch(e){console.error(`[useSidecarData] Failed to send message:`,e),y(!1),x(`Failed`),C(`failed`)}},[r,t,h]),stopStreaming:(0,v.useCallback)(()=>{r&&(n(`stopStream`,{sessionKey:h}),y(!1),x(``),C(``))},[r,n,h]),call:t,notify:n}}function fg(){let e=dg(),[t,n]=(0,v.useState)(`home`),[r,i]=(0,v.useState)(`pinned`),[a]=(0,v.useState)(260),[o,s]=(0,v.useState)(``),[c,l]=(0,v.useState)([]),[u,d]=(0,v.useState)(`glm-4.5`),[f,p]=(0,v.useState)(`build`),[m,h]=(0,v.useState)(`on`),[g,_]=(0,v.useState)(`comfort`),[y,b]=(0,v.useState)(!1),[x,S]=(0,v.useState)(!1);(0,v.useEffect)(()=>{document.documentElement.setAttribute(`data-theme`,g)},[]);let C=(0,v.useCallback)(e=>{_(e),document.documentElement.setAttribute(`data-theme`,e)},[]),w=(0,v.useCallback)(e=>{l(t=>t.includes(e)?t.filter(t=>t!==e):[...t,e])},[]),T=(0,v.useCallback)(()=>{t===`chat`&&i(e=>e===`pinned`?`hidden`:`pinned`)},[t]),E=(0,v.useCallback)(e=>{},[]),D=(0,v.useCallback)(t=>{s(t),b(!1),e.selectSession(t)},[e]),O=(0,v.useCallback)(()=>{s(``),b(!0),n(`chat`)},[]),k=(0,v.useCallback)(t=>{e.sendMessage(t,e.activeSessionId||void 0,c),b(!1)},[e,c]),A=(0,v.useCallback)(()=>{e.stopStreaming()},[e]),j=(0,v.useCallback)(e=>{n(e)},[]);if(!e.connected)return(0,z.jsxs)(`div`,{style:{display:`flex`,alignItems:`center`,justifyContent:`center`,height:`100vh`,backgroundColor:`var(--q-bg)`,flexDirection:`column`,gap:`16px`},children:[(0,z.jsx)(`div`,{style:{fontSize:`18px`,fontFamily:`var(--font-interface)`,color:`var(--q-text-secondary)`},children:`Connecting to sidecar…`}),(0,z.jsx)(`div`,{style:{fontSize:`13px`,fontFamily:`var(--font-code)`,color:`var(--q-text-tertiary)`},children:`ws://127.0.0.1:9182`}),(0,z.jsx)(`div`,{style:{width:`200px`,height:`2px`,backgroundColor:`var(--q-border)`,borderRadius:`1px`,overflow:`hidden`},children:(0,z.jsx)(`div`,{style:{width:`40%`,height:`100%`,backgroundColor:`var(--q-accent-primary)`,borderRadius:`1px`,animation:`breathe 1.5s ease-in-out infinite`}})}),e.error&&(0,z.jsx)(`div`,{style:{fontSize:`12px`,fontFamily:`var(--font-code)`,color:`var(--q-accent-danger)`,marginTop:`8px`},children:e.error}),(0,z.jsxs)(`div`,{style:{fontSize:`12px`,fontFamily:`var(--font-interface)`,color:`var(--q-text-tertiary)`,marginTop:`16px`,textAlign:`center`,maxWidth:`400px`,lineHeight:`1.6`},children:[`Start the sidecar with:`,(0,z.jsx)(`br`,{}),(0,z.jsx)(`code`,{style:{color:`var(--q-text-secondary)`,fontFamily:`var(--font-code)`},children:`cd ~/Projects/Quinki/sidecar-src && npx tsx ws-bridge.ts`})]})]});let M=e.sessions,N=e.agents,P=e.providers,F=e.messages,I=e.isStreaming,L=e.statusLabel,ee=e.statusKind,te=e.contextTokens,ne=e.contextWindow,re=M.find(e=>e.id===o),ie=t===`chat`&&r===`pinned`,R=t===`chat`&&(r===`pinned`||r===`peek`),ae=ie?a+8:0;return(0,z.jsx)(yh.Provider,{value:{call:e.call,notify:e.notify,connected:e.connected},children:(0,z.jsxs)(`div`,{className:`flex flex-col h-screen w-screen overflow-hidden`,style:{backgroundColor:`var(--q-bg)`},children:[(0,z.jsxs)(`div`,{className:`flex-1 relative overflow-hidden`,children:[(0,z.jsxs)(`div`,{className:`absolute inset-0 transition-all duration-200`,style:{padding:`8px`,paddingLeft:`${8+ae}px`},children:[t===`home`&&(0,z.jsx)(gh,{activePanel:t,onSelectPanel:j}),t===`chat`&&(0,z.jsx)(mh,{session:re,messages:F,streaming:I,welcomeMode:y,mode:f,activePanel:t,onSelectPanel:j,sidebarOpen:r===`pinned`,onToggleSidebar:T,agentDropdownOpen:x,onToggleAgentDropdown:()=>S(!x),agents:N,selectedAgentIds:c,onAgentToggle:w,providers:P,selectedModel:u,onModelSelect:d,onModeChange:p,thinking:m,onThinkingChange:h,contextTokens:te,contextWindow:ne,onSend:k,onStop:A,onRenameSession:()=>{},statusLabel:L,statusKind:ee,onExport:()=>{}}),t===`expert`&&(0,z.jsx)(mh,{session:void 0,messages:F,streaming:I,welcomeMode:y,mode:f,activePanel:t,onSelectPanel:j,sidebarOpen:!1,onToggleSidebar:()=>{},agentDropdownOpen:x,onToggleAgentDropdown:()=>S(!x),agents:N,selectedAgentIds:[`quinki-expert`],onAgentToggle:w,providers:P,selectedModel:u,onModelSelect:d,onModeChange:p,thinking:m,onThinkingChange:h,contextTokens:te,contextWindow:ne,onSend:k,onStop:A,onRenameSession:()=>{},statusLabel:L,statusKind:ee,onExport:()=>{}}),t===`agents`&&(0,z.jsx)(Sh,{activePanel:t,onSelectPanel:j,agents:N}),t===`log`&&(0,z.jsx)(rg,{activePanel:t,onSelectPanel:j}),t===`settings`&&(0,z.jsx)(Rh,{activePanel:t,onSelectPanel:j,themes:cg,activeThemeId:g,onThemeChange:C,providers:P})]}),R&&(0,z.jsx)(`div`,{className:`absolute top-2 bottom-2 transition-all duration-200`,style:{left:`8px`,width:`${a}px`},children:(0,z.jsx)(`div`,{className:`h-full overflow-hidden`,style:{backgroundColor:`var(--q-bg-panel)`,borderRadius:`var(--radius-lg)`,boxShadow:`var(--shadow-floating)`},children:(0,z.jsx)(mn,{sessions:M,activeSessionId:o,onSelectSession:D,onNewSession:O,onToggleFolder:E,onReorder:()=>{},welcomeMode:y})})}),t===`chat`&&r===`hidden`&&(0,z.jsx)(`div`,{className:`absolute top-2 bottom-2 left-0`,style:{width:`12px`},onMouseEnter:()=>i(`peek`)}),r===`peek`&&(0,z.jsx)(`div`,{className:`absolute inset-0`,style:{width:`${a+20}px`},onMouseLeave:()=>i(`hidden`)})]}),(0,z.jsx)(ig,{})]})})}var pg=class extends v.Component{state={error:null};static getDerivedStateFromError(e){return{error:e.message+`
`+(e.stack||``)}}render(){return this.state.error?(0,z.jsxs)(`div`,{style:{padding:`20px`,color:`red`,fontFamily:`monospace`,fontSize:`14px`,whiteSpace:`pre-wrap`,background:`white`,minHeight:`100vh`},children:[`ERROR: `,this.state.error]}):this.props.children}};(0,y.createRoot)(document.getElementById(`root`)).render((0,z.jsx)(v.StrictMode,{children:(0,z.jsx)(pg,{children:(0,z.jsx)(fg,{})})}));