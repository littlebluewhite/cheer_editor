<script lang="ts">
	// 使用說明：從編輯器的「使用說明」按鈕開在新分頁。
	// 用詞照 GLOSSARY.md 和畫面上的字；圖在 src/lib/guide/，原始檔在 docs/guide-diagrams/（fireworks-tech-graph 產生）。
	import { onMount } from 'svelte';
	import { resolve } from '$app/paths';
	import workflowSvg from '#lib/guide/workflow.svg';
	import screenMapSvg from '#lib/guide/screen-map.svg';
	import timeSvg from '#lib/guide/time.svg';
	import dragSvg from '#lib/guide/drag.svg';
	import walkSvg from '#lib/guide/walk.svg';
	import filesSvg from '#lib/guide/files.svg';
	// 畫面截圖：npm run guide:shots 重拍（scripts/guide-screenshots.mjs）
	import homeShot from '#lib/guide/shots/home.webp';
	import editorShot from '#lib/guide/shots/editor.webp';
	import membersShot from '#lib/guide/shots/members.webp';
	import segmentShot from '#lib/guide/shots/segment.webp';
	import timelineShot from '#lib/guide/shots/timeline.webp';
	import dragShot from '#lib/guide/shots/drag.webp';
	import actionShot from '#lib/guide/shots/action.webp';
	import printShot from '#lib/guide/shots/print.webp';

	const editorHref = resolve('/');
	/** 編輯器的完整網址：部署在哪就寫哪，所以等到瀏覽器裡才算。 */
	let editorUrl = $state('');
	onMount(() => {
		editorUrl = new URL(editorHref, location.href).href;
	});

	const toc = [
		{ id: 'what', label: '1 這是什麼' },
		{ id: 'words', label: '2 先認識幾個詞' },
		{ id: 'overview', label: '3 排一支流程的八個步驟' },
		{ id: 'features', label: '4 每個功能，一步一步' },
		{ id: 'start', label: '4.1 開始一支流程', sub: true },
		{ id: 'members', label: '4.2 隊員', sub: true },
		{ id: 'segments', label: '4.3 段', sub: true },
		{ id: 'playback', label: '4.4 播放頭和時間軸', sub: true },
		{ id: 'formations', label: '4.5 站位', sub: true },
		{ id: 'actions', label: '4.6 動作', sub: true },
		{ id: 'settings', label: '4.7 流程設定', sub: true },
		{ id: 'save', label: '4.8 存檔、分享、列印', sub: true },
		{ id: 'keys', label: '4.9 快捷鍵', sub: true },
		{ id: 'cold-read', label: '5 新手試跑' }
	];
</script>

<svelte:head>
	<title>使用說明 — 流程編輯器</title>
</svelte:head>

<div class="guide">
	<header class="head">
		<a class="brand" href={editorHref}>競技啦啦隊流程編輯器</a>
		<span class="head-title">使用說明</span>
		<span class="head-hint">從編輯器打開的話，關掉這個分頁就回到編輯器</span>
	</header>

	<div class="layout">
		<nav class="toc" aria-label="目錄">
			<b>目錄</b>
			<ol>
				{#each toc as item (item.id)}
					<li class:sub={item.sub}><a href={`#${item.id}`}>{item.label}</a></li>
				{/each}
			</ol>
		</nav>

		<main class="content">
			<section class="lead">
				<h1>使用說明</h1>
				<p>
					這份說明給第一次用的人。不用先懂程式，也不用先看過別的編排軟體。照順序讀，或直接跳到你要的那一節。
				</p>
				<div class="route">
					<b>怎麼讀最快</b>
					<ul>
						<li><b>完全沒用過：</b>讀第 1、2、3 章，然後照第 5 章「新手試跑」做一次（大約 15 分鐘）。</li>
						<li><b>用過、想查某個功能：</b>直接看第 4 章對應的那一節。</li>
						<li><b>看不懂某個詞：</b>回第 2 章查。整份說明的詞都跟畫面上的字一樣。</li>
					</ul>
				</div>
			</section>

			<!-- ───────────── 1 ───────────── -->
			<section id="what">
				<h2>1 這是什麼</h2>
				<p>
					<b>一句話：</b>教練用來排競技啦啦隊<b>流程</b>的工具。音樂、八拍、每個隊員站在哪裡、每個人在每個動作裡做什麼，全部排在同一條時間軸上。
				</p>
				<h3>它幫你做四件事</h3>
				<ol class="plain">
					<li><b>排時間：</b>把流程切成一段一段，音樂段對好拍子，口號段設好秒數。</li>
					<li><b>排站位：</b>在畫面上的場地拖隊員，排出每個時間點全隊站在哪裡。</li>
					<li><b>排動作：</b>誰在哪一拍做什麼動作、在動作裡負責什麼。</li>
					<li><b>分享：</b>存成一個檔案傳給隊員，或印成紙本的八拍表。</li>
				</ol>
				<h3>開始前要知道</h3>
				<ul class="plain">
					<li>
						編輯器的網址：<a href={editorHref}>{editorUrl || '編輯器首頁'}</a>。建議加入書籤。開過一次之後，沒有網路也能從書籤打開。
					</li>
					<li>
						用<b>電腦</b>的瀏覽器開，<b>Chrome 或 Edge 最好</b>（存檔可以直接存回同一個檔案）。隊員看流程也一樣用電腦；這一版沒有為手機設計，手機畫面太小。
					</li>
					<li>
						這一版<b>還沒有</b>：復原（Undo）、刪段、調換段的順序、調換隊員名單的順序、把站位整張移到別的時間。
					</li>
					<li>
						<b>哪些刪除會先問你：</b>刪隊員、把段縮短到放不下東西、還沒存就換別的流程，會先問你。<b>刪站位、刪動作不會問</b>，按了就刪，而且不能復原。不放心就先存檔（見
						<a href="#save">4.8</a>）。
					</li>
				</ul>
			</section>

			<!-- ───────────── 2 ───────────── -->
			<section id="words">
				<h2>2 先認識幾個詞</h2>
				<p>
					整份說明、整個編輯器只用下面這些詞，同一件事不會換別的說法。分兩張表：<b>啦啦隊的詞</b>（流程本身的東西）和<b>畫面上的名稱</b>（編輯器的哪個區域、哪個按鈕）。
				</p>

				<h3>2.1 啦啦隊的詞</h3>
				<div class="table-wrap">
					<table>
						<thead><tr><th>詞</th><th>意思</th></tr></thead>
						<tbody>
							<tr class="group"><td colspan="2">時間</td></tr>
							<tr><td><b>流程</b></td><td>一支隊伍從開始到結束的完整編排，由一串<b>段</b>依序接成。不含進場和退場。</td></tr>
							<tr><td><b>段</b></td><td>流程裡的一個時間區間。只有兩種：音樂段、口號段。段的名字自動取，例如「音樂 1」「口號 1」。</td></tr>
							<tr><td><b>音樂段</b></td><td>跟著一個音樂檔表演的段，有自己的 BPM 和第一拍，長度用八拍算。音樂中途變速時，切成兩個音樂段。</td></tr>
							<tr><td><b>口號段</b></td><td>沒有音樂、隊員喊出口號的段，長度只用秒數算，不數八拍。</td></tr>
							<tr><td><b>八拍</b></td><td>連續 8 拍算 1 個八拍，是排時間的主要單位。</td></tr>
							<tr><td><b>BPM</b></td><td>每分鐘幾拍。120 BPM 就是一秒兩拍。</td></tr>
							<tr><td><b>第一拍</b></td><td>音樂段在音樂檔裡開始數拍的那個時間點（第幾秒）。</td></tr>
							<tr class="group"><td colspan="2">場地</td></tr>
							<tr><td><b>場地</b></td><td>表演用的體操墊範圍，由幾條併成。場地外 1 公尺內，隊員也能站。</td></tr>
							<tr><td><b>條</b></td><td>一條體操墊。場地大小用「幾條」算。</td></tr>
							<tr><td><b>鋪向</b></td><td>條的鋪法：<b>直放</b>是每條從前鋪到後，<b>橫放</b>是每條從左鋪到右。</td></tr>
							<tr><td><b>正面</b></td><td>場地朝裁判的那一邊。畫面上永遠在下面，寫著「▼ 正面／裁判 ▼」。</td></tr>
							<tr><td><b>接縫</b></td><td>相鄰兩條之間的線，隊員在場上看得到，用來對位置。</td></tr>
							<tr><td><b>格</b></td><td>場地上的一個正方形，邊長等於一條的寬。一條剛好 7 格長，所以可以用「第幾條、第幾格」講位置。</td></tr>
							<tr class="group"><td colspan="2">人和角色</td></tr>
							<tr><td><b>隊員</b></td><td>流程裡的一個人，有名字、性別、全局角色。只放會上場的人；候補要上場時，把被換下的隊員改成他的名字。一支流程最多 40 人。</td></tr>
							<tr><td><b>全局角色</b></td><td>隊員在整支流程裡固定的身分，只分<b>底層</b>和<b>上層</b>。它決定場地上圓點的顏色（圖例的「底層」「上層」），也決定「全部底層」「全部上層」按鈕選到誰。</td></tr>
							<tr>
								<td><b>任務角色</b></td>
								<td>
									隊員在<b>某一個動作</b>裡要做的事，每個動作可以不同，也可以沒有。跟全局角色互不影響：全局角色是底層的人，在某個金字塔裡可以當中層。
									<b>「底層」「上層」兩種角色都有這個名字</b>：全局的上層是整支流程固定的身分；任務的上層是在這一個動作裡被撐起來的人。
								</td>
							</tr>
							<tr class="group"><td colspan="2">任務角色的名稱（編輯器固定有這 11 個，也可以自訂）</td></tr>
							<tr><td><b>底層</b></td><td>在下面撐住別人的人。不想分主底、側底時用這個。</td></tr>
							<tr><td><b>主底</b></td><td>主要撐住上層腳的底層。只有一個底層的技巧，那個人就是主底。</td></tr>
							<tr><td><b>側底</b></td><td>在主底旁邊一起撐的底層。</td></tr>
							<tr><td><b>上層</b></td><td>被撐在最上面的人。</td></tr>
							<tr><td><b>中層</b></td><td>金字塔裡站在底層身上、又撐住上面的人的人。</td></tr>
							<tr><td><b>保護</b></td><td>站在旁邊保護上層的人。可以扶腳踝、小腿、膝蓋，不能撐腳底，不算底層。</td></tr>
							<tr><td><b>後保</b></td><td>站在上層背後的人。</td></tr>
							<tr><td><b>前保</b></td><td>站在上層前方的保護。</td></tr>
							<tr><td><b>接者</b></td><td>接住落下或被拋的上層的人。</td></tr>
							<tr><td><b>支撐</b></td><td>金字塔裡穩住別的上層的人。</td></tr>
							<tr><td><b>騰翻</b></td><td>做騰翻的人。騰翻是自己完成、沒人撐的翻滾（也是動作的一個大類）。</td></tr>
							<tr class="group"><td colspan="2">動作和位置</td></tr>
							<tr><td><b>動作</b></td><td>一組隊員在一個段裡一起做的一件事，有開始的時間和長度。可以一個人，也可以全隊。<b>動作不能跨段</b>；一個隊員同一時間只能在一個動作裡。</td></tr>
							<tr><td><b>大類</b></td><td>動作屬於哪一種，只有七個：技巧、金字塔、拋投、騰翻、跳躍、舞蹈、其他。</td></tr>
							<tr><td><b>站位</b></td><td>全隊在流程某一拍各站在場地哪裡，像一張圖。流程開頭一定有一張。</td></tr>
							<tr><td><b>走位</b></td><td>隊員從一張站位的位置走到下一張站位的位置。走位不是動作，可以邊做動作邊走位。</td></tr>
							<tr class="group"><td colspan="2">檔案和紙本</td></tr>
							<tr><td><b>流程檔</b></td><td>一支流程存成的一個檔案（<code>流程名字.zip</code>），裡面有全部資料和用到的音樂檔。傳給隊員，隊員用同一個編輯器打開。</td></tr>
							<tr><td><b>草稿</b></td><td>編輯器自動存在<b>這台電腦的瀏覽器</b>裡的備份，防止忘了存檔。不是流程檔，不能傳給別人。</td></tr>
							<tr><td><b>八拍表</b></td><td>把流程照八拍一列一列寫下來的表，每列寫那個八拍開始的動作，有站位的地方附小站位圖。可以印全隊的，也可以只印一個隊員的。</td></tr>
						</tbody>
					</table>
				</div>

				<figure class="diagram">
					<a href={timeSvg} target="_blank" rel="noopener"
						><img src={timeSvg} alt="時間怎麼算：流程由音樂段和口號段接成；音樂段切成八拍，每個八拍 8 拍，最細到半拍；口號段只算秒數，最細 0.1 秒。例：「音樂 1 3-5&」是第 1 個音樂段、第 3 個八拍、第 5 拍再過半拍。" /></a
					>
					<figcaption>圖 1　時間怎麼算。畫面上的時間都寫成「段名 八拍-拍」，例如「音樂 1 3-5&amp;」；口號段寫秒數，例如「口號 1 4.5 秒」。</figcaption>
				</figure>

				<h3>2.2 畫面上的名稱</h3>
				<figure class="diagram">
					<a href={screenMapSvg} target="_blank" rel="noopener"
						><img src={screenMapSvg} alt="編輯畫面的四個區域：上方列（流程名字和使用說明、播放鍵和目前位置、按鈕）、場地（隊員圓點、放大縮小、提示）、右邊欄（動作分頁、隊員分頁）、時間軸（段列、八拍尺、站位列、泳道）。" /></a
					>
					<figcaption>圖 2　編輯畫面的四個區域。圖 3 是真的畫面；下面的表是每個區域裡的名稱；第 4 章每一節開頭都會說在哪個區域操作。</figcaption>
				</figure>
				<figure class="diagram shot">
					<a href={editorShot} target="_blank" rel="noopener"
						><img src={editorShot} style:max-width="820px" alt="真的編輯畫面，第 5 章試跑做完的樣子：1 上方列、2 場地、3 右邊欄、4 時間軸，各用紅框圈起來。" /></a
					>
					<figcaption>圖 3　真的編輯畫面（第 5 章試跑做完的樣子）。① 上方列　② 場地　③ 右邊欄　④ 時間軸。</figcaption>
				</figure>
				<div class="table-wrap">
					<table>
						<thead><tr><th>名稱</th><th>在哪裡、是什麼</th></tr></thead>
						<tbody>
							<tr><td><b>首頁</b></td><td>還沒打開流程時看到的畫面：左邊是介紹，右邊是「新建流程」和「開啟流程檔」。</td></tr>
							<tr><td><b>編輯畫面</b></td><td>打開一支流程之後的畫面，分成下面四個區域。</td></tr>
							<tr class="group"><td colspan="2">上方列</td></tr>
							<tr><td><b>上方列</b></td><td>最上面深藍色的那一列：左邊是流程名字和「使用說明」，中間是播放鍵、目前位置、節拍器、延遲校正，右邊是「八拍表」「流程設定」「開啟」「新建」「存檔」。</td></tr>
							<tr><td><b>目前位置</b></td><td>上方列中間的深色小框，寫播放頭在哪，例如「音樂 1 3-5&amp;」，下面一行是秒數。</td></tr>
							<tr class="group"><td colspan="2">場地</td></tr>
							<tr><td><b>場地</b></td><td>畫面中間的圖，就是 2.1 的場地照比例畫出來。圓點是隊員，點上的數字是他在名單裡的順序。左下角是圖例（底層、上層、正在上面），右上角是放大、縮小、全場和目前的放大倍數（例如「×1.0」）。</td></tr>
							<tr><td><b>提示</b></td><td>場地上方中間的深藍小框，告訴你剛剛發生什麼事或為什麼不能做；按 × 收起。</td></tr>
							<tr><td><b>規則警告</b></td><td>場地右下角的黃色小框。口號段加起來比「口號段最少」短、音樂段加起來比上限長、整支流程比上限長時出現。只提醒，不擋你。預設就開著，在「流程設定」可以關掉或改數字（見 <a href="#settings">4.7</a>）。</td></tr>
							<tr class="group"><td colspan="2">右邊欄</td></tr>
							<tr><td><b>右邊欄</b></td><td>右邊有兩個分頁：「動作」和「隊員」。點分頁的名字就換過去。</td></tr>
							<tr><td><b>名單</b></td><td>「隊員」分頁上半部，所有隊員一行一個，可以直接改名字、性別、全局角色。</td></tr>
							<tr><td><b>選人</b></td><td>「動作」分頁最上面那一區，有「全隊」「全部底層」等按鈕，用來選這次動作的人。</td></tr>
							<tr><td><b>動作表單</b></td><td>「動作」分頁「選人」下面那一區，填大類、名稱、開始、長度、人和任務角色。標題寫「在播放頭新增動作」時是新增；寫「動作」時是在改一個已經有的動作。</td></tr>
							<tr><td><b>名詞對照表</b></td><td>動作表單裡「人＋任務角色」那一行右邊的連結，列出全部任務角色和意思。</td></tr>
							<tr class="group"><td colspan="2">時間軸</td></tr>
							<tr><td><b>時間軸</b></td><td>畫面最下面，左右是時間，由上往下四列：段列、八拍尺、站位列、泳道。</td></tr>
							<tr><td><b>段列</b></td><td>時間軸第一列，每一段是一個長方形。左邊的「＋」加段。</td></tr>
							<tr><td><b>八拍尺</b></td><td>時間軸第二列，像尺一樣標著八拍的號碼（口號段標秒數）。左邊的「−」「＋」放大、縮小時間軸。</td></tr>
							<tr><td><b>站位列</b></td><td>時間軸第三列，每張站位一個小圖。</td></tr>
							<tr><td><b>泳道</b></td><td>時間軸第四列，每個隊員有自己的一條泳道。他參加的動作畫成<b>色條</b>：顏色看大類；動作裡第一個人的色條先寫「大類·名稱」（例如「技巧·Lib」），每條色條再寫那個人的任務角色（色條太短寫不下時，滑鼠移過去就看得到）。沒在動作裡的時間是灰色斜紋。</td></tr>
							<tr><td><b>播放頭</b></td><td>時間軸上那根橘紅色直線，表示「現在」。場地顯示的就是播放頭這一刻大家站在哪。</td></tr>
							<tr class="group"><td colspan="2">跳出來的視窗</td></tr>
							<tr><td><b>段設定</b></td><td>點段列上的段跳出來，設定那一段的音樂檔、BPM、第一拍、長度。音樂段的段設定裡有<b>波形</b>：音樂聲音大小的圖，鼓點的地方會突起來。</td></tr>
						</tbody>
					</table>
				</div>
			</section>

			<!-- ───────────── 3 ───────────── -->
			<section id="overview">
				<h2>3 排一支流程的八個步驟</h2>
				<p>排一支流程，大致就是下面八步。順序不是死的（例如可以先排動作再回來調站位），但第一次照這個順序最不會卡住。</p>
				<figure class="diagram">
					<a href={workflowSvg} target="_blank" rel="noopener"
						><img src={workflowSvg} alt="從零到一支流程的八個步驟：1 新建流程、2 加隊員、3 加段、4 排站位、5 加動作、6 播放檢查、7 存檔、8 分享。播放檢查發現不對，就回到之前的步驟改。" /></a
					>
					<figcaption>圖 4　八個步驟。播放檢查發現不對，就回去改。</figcaption>
				</figure>
				<ol class="steps">
					<li><b>新建流程：</b>取名字，選場地（幾條、直放或橫放）。場地<b>建好之後不能換</b>，先確認比賽用哪種。</li>
					<li><b>加隊員：</b>把會上場的人加進名單。名單的順序就是場地圓點上的數字，也是泳道的順序，而且之後不能調，所以照你要的順序加。</li>
					<li><b>加段：</b>照真正表演的順序，一段一段加在最後面。音樂段要載入音樂檔、對好第一拍和 BPM。</li>
					<li><b>排站位：</b>把播放頭移到某一拍，在場地上拖隊員。拖完，那一拍就有一張站位；兩張站位之間，隊員會自己走位。</li>
					<li><b>加動作：</b>把播放頭移到動作開始的那一拍，選人、選大類、填長度、給每個人任務角色。</li>
					<li><b>播放檢查：</b>從頭播一次，看場地上的人怎麼走、泳道上誰在做什麼。不對就回第 2–5 步改。</li>
					<li><b>存檔：</b>得到一個流程檔。上方列流程名字旁邊的「未存」消失，就是存好了。</li>
					<li><b>分享：</b>把流程檔傳給隊員，或印八拍表。</li>
				</ol>
			</section>

			<!-- ───────────── 4 ───────────── -->
			<section id="features">
				<h2>4 每個功能，一步一步</h2>
				<p>照第 3 章八個步驟的順序排。每個功能都寫：<b>做什麼用</b>、<b>怎麼做</b>、<b>要注意</b>。按鈕的名字用「」括起來，跟畫面上的字一模一樣。</p>
			</section>

			<section id="start">
				<h3 class="sec">4.1 開始一支流程</h3>
				<p class="where">在<b>首頁</b>操作。三種開始的方法，選一種。在編輯畫面按上方列的「新建」，會回到首頁。</p>
				<figure class="diagram shot">
					<a href={homeShot} target="_blank" rel="noopener"
						><img src={homeShot} style:max-width="820px" alt="首頁：1 新建流程（流程名字、場地、建立）、2 開啟流程檔、3 右上角的使用說明。" /></a
					>
					<figcaption>圖 5　首頁。① 新建流程　② 開啟流程檔　③ 使用說明。</figcaption>
				</figure>

				<h4>新建流程</h4>
				<p class="purpose">從零開始排一支新的流程。</p>
				<ol class="steps">
					<li>在「流程名字」打一個名字，例如「2027 全國賽」。</li>
					<li>在「場地」選一種：「9 條直放（預設）」（全國賽、中等學校、大專）、「5 條橫放」（臺灣盃），或「自訂」（條數 1–12，鋪向直放或橫放）。</li>
					<li>按「建立」。</li>
				</ol>
				<p class="note">要注意：場地建好之後不能換。名字之後可以在「流程設定」改。</p>

				<h4>開啟流程檔</h4>
				<p class="purpose">繼續編之前存的流程，或打開別人傳給你的流程檔。</p>
				<ol class="steps">
					<li>按首頁的「開啟流程檔」，或編輯畫面上方列的「開啟」。</li>
					<li>選那個 <code>.zip</code> 檔。</li>
				</ol>
				<p class="note">
					要注意：出現「這不是流程檔」表示選錯檔，或檔案壞了。出現「這個流程檔是新版編輯器存的」就重新整理網頁，拿到新版編輯器。段列上有段變成紅色、寫「找不到音樂」，見
					<a href="#segments">4.3</a> 的「找不到音樂」。
				</p>

				<h4>救回草稿</h4>
				<p class="purpose">上次編到一半沒存就關掉，把它找回來。</p>
				<ol class="steps">
					<li>打開編輯器時，首頁如果問「上次編的『…』還沒存，要救回嗎？」</li>
					<li>按「救回」接著編；按「丟掉」就不要了。</li>
				</ol>
				<p class="note">要注意：草稿只存在這台電腦的這個瀏覽器，換電腦就沒有。它只是保險，真正要留的還是要「存檔」（見 <a href="#save">4.8</a>）。</p>
			</section>

			<section id="members">
				<h3 class="sec">4.2 隊員</h3>
				<p class="where">在<b>右邊欄的「隊員」分頁</b>操作。新流程打開時就在這一頁。</p>
				<figure class="diagram shot">
					<a href={membersShot} target="_blank" rel="noopener"
						><img src={membersShot} style:max-width="360px" alt="右邊欄的隊員分頁：1 名字欄（一行一個）、2 性別和全局角色、3 加隊員按鈕、4 名單。" /></a
					>
					<figcaption>圖 6　「隊員」分頁。① 名字（一次加多人：一行一個）　② 性別、全局角色　③ 「加隊員」　④ 名單。</figcaption>
				</figure>

				<h4>加隊員</h4>
				<p class="purpose">把會上場的人放進名單。</p>
				<ol class="steps">
					<li>在「名字（一次加多人：一行一個）」打名字。一次加很多人：打完一個名字按 Enter 換行，再打下一個（Enter 只會換行，不會送出）。</li>
					<li>選「性別」和「全局角色」（底層或上層）。這兩個會套用到這次加的每個人，所以同性別、同全局角色的人一起加最快。</li>
					<li>按「加隊員」。</li>
				</ol>
				<p class="note">
					新加的人會出現在場地正面那一邊的場地外，排成一排，不會疊在一起。之後再拖到你要的位置（見 <a href="#formations">4.5</a>）。最多 40 人。名單順序就是圓點上的號碼和泳道的順序，這一版不能調，所以照你要的順序加。
				</p>

				<h4>改隊員</h4>
				<p class="purpose">改名字、性別、全局角色。候補上場時，就把被換下的人改成候補的名字：站位和動作都會跟著這個人，不用重排。</p>
				<ol class="steps">
					<li>在名單裡直接改名字欄，或改性別、全局角色的下拉選單。</li>
				</ol>

				<h4>刪隊員</h4>
				<ol class="steps">
					<li>按那個人右邊的垃圾桶。</li>
					<li>畫面會先問你，並寫出他在幾個動作裡；只有他一個人的動作會整個被刪掉，那些動作會列出來。確定才按確定。</li>
				</ol>
			</section>

			<section id="segments">
				<h3 class="sec">4.3 段</h3>
				<p class="where">在<b>時間軸的段列</b>和<b>段設定</b>操作。</p>

				<h4>加段</h4>
				<p class="purpose">把流程的時間一段一段排出來。照真正表演的順序加。</p>
				<ol class="steps">
					<li>按段列最左邊「段」旁的「＋」。</li>
					<li>選「＋音樂段」或「＋口號段」。新段會加在最後面，段設定自動打開。</li>
				</ol>
				<p class="note">新的音樂段預設 150 BPM、8 個八拍；新的口號段預設 10 秒。段的名字自動取（音樂 1、口號 1…），不能改。這一版只能加在最後面，不能刪段、不能調換順序。</p>

				<h4>設定音樂段</h4>
				<p class="purpose">讓編輯器知道音樂從哪一刻開始數「1」、多快，這樣八拍尺、節拍器、動作的時間才會對到音樂。</p>
				<figure class="diagram shot">
					<a href={segmentShot} target="_blank" rel="noopener"
						><img src={segmentShot} style:max-width="680px" alt="音樂段的段設定：1 載入音樂檔、2 BPM、3 第一拍（秒）、4 波形（粗線是第一拍，細線是每一拍）、5 試聽按鈕、6 長度。" /></a
					>
					<figcaption>圖 7　音樂段的段設定。① 「載入音樂檔」　② BPM　③ 第一拍（秒）　④ 波形：橘紅粗線是第一拍，細線是每一拍，細線對準鼓點就對了　⑤ 試聽　⑥ 長度。</figcaption>
				</figure>
				<ol class="steps">
					<li><b>打開段設定：</b>點段列上那一段。</li>
					<li><b>載入音樂檔：</b>按「載入音樂檔」，選 mp3、m4a 或 wav。載入後會畫出前 20 秒的波形。</li>
					<li><b>填 BPM：</b>在「BPM」打數字（60–170）。</li>
					<li><b>對第一拍：</b>在波形上點你開始數「1」的那個鼓點。橘紅粗線就是第一拍，後面的細線是照 BPM 算出來的每一拍，比較亮的是每個八拍的開頭。<b>細線一直對準鼓點，BPM 和第一拍就都對了</b>；越後面越偏，就是 BPM 不對。也可以直接在「第一拍（秒）」打數字。</li>
					<li><b>試聽：</b>按「▶ 從第一拍聽 2 個八拍」，節拍器的聲音應該跟音樂的拍子一起。</li>
					<li><b>設長度：</b>按「照音樂長度算」，或自己填「八拍數」和「最後一個八拍有幾拍」（最後一個八拍可以不滿 8 拍）。</li>
					<li>按右上角的 × 關閉。</li>
				</ol>
				<p class="note">
					要注意：沒有音樂檔也可以先排，播放時只有節拍器的聲音。音樂中途變速時，加第二個音樂段，在「用已載入的音樂」選同一個音樂檔，再對那一段自己的 BPM 和第一拍。
				</p>

				<h4>設定口號段</h4>
				<ol class="steps">
					<li>點段列上的口號段。</li>
					<li>在「長度（秒）」打秒數，最細 0.1 秒。</li>
				</ol>

				<h4>把段縮短</h4>
				<p class="note">
					段縮短後，放不進去的動作或站位會被刪掉。畫面會先列出哪些會被刪，你按確定才改；按取消就回到原本的長度。
				</p>

				<h4>找不到音樂</h4>
				<p class="note">
					段列上紅色、寫「找不到音樂」的段，表示流程檔裡少了那個音樂檔。點那一段，按「載入音樂檔」重新選。動作和站位都不會動。
				</p>
			</section>

			<section id="playback">
				<h3 class="sec">4.4 播放頭和時間軸</h3>
				<p class="where">在<b>上方列</b>和<b>時間軸</b>操作。</p>
				<p>
					<b>播放頭</b>是整個編輯器的「現在」：場地顯示播放頭這一刻的站位，新動作從播放頭開始，拖人改的是播放頭這一拍的站位。所以多數操作前，先把播放頭移到對的地方。
				</p>
				<figure class="diagram shot">
					<a href={timelineShot} target="_blank" rel="noopener"
						><img src={timelineShot} style:max-width="760px" alt="時間軸：1 段列、2 八拍尺、3 站位列、4 泳道、5 播放頭（橘紅色直線）。" /></a
					>
					<figcaption>圖 8　時間軸。① 段列　② 八拍尺　③ 站位列　④ 泳道　⑤ 播放頭。</figcaption>
				</figure>

				<h4>移動播放頭</h4>
				<ol class="steps">
					<li>在八拍尺上點一下，播放頭就跳到那裡；按住拖可以慢慢找。</li>
					<li>看上方列的目前位置，確認在你要的那一拍，例如「音樂 1 3-1」。差一點就再點一次。</li>
				</ol>

				<h4>播放、暫停</h4>
				<ol class="steps">
					<li>按上方列的圓形播放鍵。從播放頭開始播；已經播到最後就從頭播。</li>
					<li>再按一次暫停。</li>
				</ol>
				<p class="note">也可以按空白鍵。但游標還在輸入框裡（例如剛打完名字）時，空白鍵只會打出空格；先點一下場地或時間軸的空白處再按。</p>

				<h4>節拍器</h4>
				<p class="purpose">播放時每一拍響一聲，每個八拍的「1」比較重。按上方列的「節拍器」開或關。</p>

				<h4>延遲校正（毫秒）</h4>
				<p class="purpose">
					用藍牙耳機或喇叭時，聲音會比畫面慢一點。覺得畫面比聲音快，就把這個數字調大（每次加 10 試試）。這個數字只存在這台電腦，不會存進流程檔。
				</p>

				<h4>時間軸放大、縮小</h4>
				<p class="purpose">八拍尺左邊「八拍」旁的「−」「＋」，中間的數字是目前倍數（例如「×1」）。也可以把滑鼠放在時間軸上，按住 Ctrl（Mac 按 ⌘）滾滾輪，或在觸控板上兩指捏合。放大看得清楚每一拍，縮小看得到整支流程。</p>
			</section>

			<section id="formations">
				<h3 class="sec">4.5 站位</h3>
				<p class="where">在<b>場地</b>和<b>時間軸的站位列</b>操作。</p>
				<p>
					站位是「某一拍全隊站在哪裡」。你不用先「新增一張站位」：<b>只要把播放頭移到那一拍，在場地上拖人，站位就有了</b>。兩張站位之間，每個人從前一張站位那一拍開始走，直線、平均速度，剛好在下一張站位那一拍走到（走位）。
				</p>
				<figure class="diagram">
					<a href={walkSvg} target="_blank" rel="noopener"
						><img src={walkSvg} alt="站位和走位：站位 1 在流程開頭，一定有、不能刪；站位 1 走位到站位 2，站位 2 走位到站位 3；最後一張之後站著不動。" /></a
					>
					<figcaption>圖 9　站位和走位。</figcaption>
				</figure>

				<h4>拖人（排站位）</h4>
				<ol class="steps">
					<li>把播放頭移到你要的那一拍（見 <a href="#playback">4.4</a>）。</li>
					<li>在場地上按住一個隊員，拖到新位置，放開。</li>
					<li>那一拍原本就有站位，就改那張；沒有，就插一張新的，其他人的位置自動帶入（提示會寫「插了一張站位，大家的位置自動帶入」）。</li>
				</ol>
				<figure class="diagram">
					<a href={dragSvg} target="_blank" rel="noopener"
						><img src={dragSvg} alt="在場地上拖隊員時：放開後，看播放頭這一拍有沒有站位；有就改那張站位，只動你拖的人；沒有就插一張新站位，其他人照原本走到的位置；最後播放頭停在這張站位。" /></a
					>
					<figcaption>圖 10　拖人時，編輯器怎麼決定改哪一張站位。</figcaption>
				</figure>
				<p class="note">
					<b>拖的時候會寫他在哪</b>，例如「第 5 條 左起 1/2｜前起第 4 格 1/2」：在第 5 條、這條從左邊算起一半的地方；從正面往後數第 4 格、這格一半的地方。<br />
					<b>吸附：</b>放開時，隊員會自動對齊到最近的點：格子的線、1/4、1/2、3/4 格。拖的時候看得到這些小點。場地放大到 ×2 以上，還會多出 1/8 格的點。<br />
					<b>能站的範圍：</b>場地外 1 公尺以內。拖太遠會被擋，提示寫「只能站到墊子外 1 m 以內」（這裡的墊子就是場地）。
				</p>
				<figure class="diagram shot">
					<a href={dragShot} target="_blank" rel="noopener"
						><img src={dragShot} style:max-width="820px" alt="在場地上拖小美的時候：1 正在拖的隊員，旁邊的黃色小點是吸附的點；2 左上角寫著他在第幾條、第幾格。" /></a
					>
					<figcaption>圖 11　拖人的時候。① 正在拖的隊員，黃色小點是吸附的點　② 他在哪：第幾條、第幾格。</figcaption>
				</figure>

				<h4>選取隊員、一次拖一組人</h4>
				<ol class="steps">
					<li><b>選一個：</b>在場地上點他（或點泳道上他的名字）。選到的人外面會多一圈青色。</li>
					<li><b>選好幾個：</b>按住 Shift 再點，或在場地空白的地方按住拖出一個框，框到的人都選起來。</li>
					<li><b>一起拖：</b>拖其中一個人，選到的整組一起移動，彼此的距離不變。</li>
					<li><b>取消選取：</b>點場地空白的地方，或按 Esc。</li>
				</ol>
				<p class="note">在這裡選到的人，也就是新增動作時的人（見 <a href="#actions">4.6</a>）。</p>

				<h4>場地放大、縮小</h4>
				<p class="purpose">場地右上角的「−」「＋」，或在場地上滾滑鼠滾輪。按「全場」回到看得到整個場地。</p>

				<h4>看、刪站位</h4>
				<ol class="steps">
					<li>點站位列上的小圖：選到那張站位，播放頭跳過去。</li>
					<li>要刪：按小圖右上角的 ×，或選到後按 Delete（Mac 是 delete 鍵）。<b>不會先問，按了就刪。</b></li>
				</ol>
				<p class="note">要注意：流程開頭那張站位（站位 1）一定在，不能刪。這一版不能把站位整張移到別的時間：在新的那一拍拖人插一張，再刪掉舊的。</p>
			</section>

			<section id="actions">
				<h3 class="sec">4.6 動作</h3>
				<p class="where">在<b>右邊欄的「動作」分頁</b>和<b>泳道</b>操作。</p>

				<h4>新增動作</h4>
				<p class="purpose">記下「誰、在哪一拍、做什麼、各自負責什麼」。</p>
				<figure class="diagram shot">
					<a href={actionShot} target="_blank" rel="noopener"
						><img src={actionShot} style:max-width="360px" alt="右邊欄的動作分頁：1 動作分頁、2 選人、3 大類和名稱、4 開始和長度、5 人和任務角色、6 新增動作按鈕。" /></a
					>
					<figcaption>圖 12　「動作」分頁。① 「動作」分頁　② 選人　③ 大類、名稱　④ 開始、長度　⑤ 人＋任務角色　⑥ 「新增動作」。</figcaption>
				</figure>
				<ol class="steps">
					<li><b>移播放頭：</b>移到動作開始的那一拍。動作表單的標題寫「在播放頭新增動作」，下面寫這個動作在哪一段。</li>
					<li>
						<b>選人：</b>按「選人」那一區的按鈕：「全隊」「全部底層」「全部上層」「這一拍沒在動作裡的人」「沿用上一個動作的人」（再按一次換更早的動作）。也可以在場地上選取（見
						<a href="#formations">4.5</a>）。選到的人會出現在動作表單的「人」清單裡。還可以用「＋加人…」一個一個加，或用「從別的動作複製人（連任務角色）…」整組帶進來。
					</li>
					<li><b>選大類：</b>技巧、金字塔、拋投、騰翻、跳躍、舞蹈、其他。</li>
					<li><b>填名稱：</b>可以不填，例如「Lib」「籃拋」。</li>
					<li>
						<b>確認開始和長度：</b>開始已經照播放頭填好；音樂段的長度預設 8 拍（1 個八拍）。音樂段的開始寫成「八拍-拍」，例如「3-5」，半拍加「&amp;」，例如「3-5&amp;」；長度寫幾拍，8 拍＝1 個八拍。口號段兩個都寫秒數。
					</li>
					<li><b>給任務角色：</b>在每個人旁邊的下拉選單選，例如主底、側底、上層、保護。意思見 <a href="#words">2.1</a>，或按「名詞對照表」。</li>
					<li><b>備註：</b>有要提醒的就寫。</li>
					<li>按「新增動作」。泳道上每個人都多一條色條；動作表單變成這個動作的內容（標題寫「動作」），可以接著改。要再新增別的動作，按表單上面的「＋ 新增動作」。</li>
				</ol>
				<p class="note">
					做不出來時，動作表單下面會寫原因。最常見的：「動作不能跨段，要跨就拆成兩個」「一個動作至少要有 1 個人」「某某 同一時間已經在『…』裡」。照原因改就好。
				</p>

				<h4>改動作</h4>
				<ol class="steps">
					<li>在泳道上點那個動作的色條。動作表單換成那個動作的內容。</li>
					<li>直接改任何欄位，改了馬上生效（不用按儲存）。</li>
					<li>改完要新增別的動作，按表單上面的「＋ 新增動作」（或按 Esc）。</li>
				</ol>

				<h4>在泳道上拖動作</h4>
				<ol class="steps">
					<li><b>換時間：</b>按住色條左右拖，放開。整個動作（所有人）一起移。</li>
					<li><b>改長度：</b>按住色條最右邊拖。</li>
				</ol>
				<p class="note">放開時如果不合規則（例如跨段、撞到同一個人的別的動作），會還原，提示寫原因和「已還原」。</p>

				<h4>刪動作</h4>
				<p class="purpose">點色條選到它，按動作表單上的「刪除動作」，或按 Delete（Mac 是 delete 鍵）。<b>不會先問，按了就刪。</b></p>

				<h4>自訂任務角色</h4>
				<ol class="steps">
					<li>按「名詞對照表」，在下面「新增自訂角色」填角色名稱和意思，按「新增角色」。或在任務角色下拉選單選「＋自訂角色…」，會打開同一個地方。</li>
				</ol>
				<p class="note">自訂角色只存在這一支流程裡。</p>

				<h4>看誰在上面、誰閒著</h4>
				<p class="purpose">
					<b>在上面：</b>任務角色是上層或中層的人，在那個動作的時間裡，場地上會畫在最上面、加黃框（場地左下角的圖例寫「正在上面」）。看的是任務角色，不是全局角色。<br />
					<b>閒著：</b>泳道上沒在動作裡的時間是灰色斜紋；播放頭那一拍閒著的人，泳道左邊的名字會變灰、標「閒」。
				</p>
			</section>

			<section id="settings">
				<h3 class="sec">4.7 流程設定</h3>
				<p class="where">按<b>上方列的「流程設定」</b>。</p>
				<ul class="plain">
					<li><b>流程名字：</b>改名字。</li>
					<li>
						<b>規則警告（只提醒，不擋）：</b>預設打勾。打勾時，口號段加起來少於第一個數字，或音樂段、整支流程超過後兩個數字，場地右下角就出現規則警告：「口號段最少（秒）」（所有口號段加起來，預設 30）、「音樂段加起來最多（秒）」（預設 120）、「整支流程最多（秒）」（預設 180）。照你要參加的比賽規則改；不要提醒就取消打勾。
					</li>
				</ul>
				<p class="note">新流程還沒有口號段，所以一開始就會看到「口號段共 0.0 秒，少於 30 秒」。這是正常的，加了口號段就會消失。</p>
			</section>

			<section id="save">
				<h3 class="sec">4.8 存檔、分享、列印</h3>
				<p class="where">在<b>上方列</b>操作。</p>
				<figure class="diagram">
					<a href={filesSvg} target="_blank" rel="noopener"
						><img src={filesSvg} alt="存檔、草稿、分享：正在編的流程，停手 1 秒自動存成草稿在這台電腦，下次打開首頁會問你救回或丟掉；按存檔得到流程檔（流程名字.zip，裝著音樂檔），傳給隊員，隊員按開啟流程檔就看得到；按八拍表可以列印或存 PDF。" /></a
					>
					<figcaption>圖 13　流程檔、草稿、八拍表三樣東西的差別。</figcaption>
				</figure>

				<h4>存檔</h4>
				<ol class="steps">
					<li>按上方列的「存檔」，或按 ⌘S（Mac）／Ctrl+S（Windows）。</li>
					<li>Chrome、Edge：第一次會問你存在哪裡，之後按存檔就直接存回同一個檔。其他瀏覽器：每次都下載一個新的 <code>流程名字.zip</code>。</li>
					<li>流程名字旁邊的「未存」消失，就是存好了。</li>
				</ol>
				<p class="note">
					要注意：按「新建」或「開啟」換別的流程時，如果有還沒存的修改，畫面會問你；按「不存了，繼續」才會換。
				</p>

				<h4>草稿（自動）</h4>
				<p class="purpose">
					你停手 1 秒，編輯器就把目前的流程存成草稿。存檔之後草稿就不需要了，會自動清掉。救回草稿見 <a href="#start">4.1</a>。
				</p>

				<h4>傳給隊員</h4>
				<ol class="steps">
					<li>把存好的 <code>流程名字.zip</code> 用 LINE、雲端硬碟等方式傳給隊員。不要解壓縮。</li>
					<li>隊員用電腦打開同一個編輯器（網址見 <a href="#what">第 1 章</a>），在首頁按「開啟流程檔」選那個檔。音樂已經在檔案裡，他可以直接播放。</li>
				</ol>

				<h4>八拍表</h4>
				<ol class="steps">
					<li>按上方列的「八拍表」。</li>
					<li>在「印誰」選全隊，或只選一個隊員（只列他有參加的動作）。</li>
					<li>按「列印」。在列印視窗可以選印表機，或存成 PDF。</li>
					<li>按「關閉」回到編輯畫面。</li>
				</ol>
				<figure class="diagram shot">
					<a href={printShot} target="_blank" rel="noopener"
						><img src={printShot} style:max-width="820px" alt="八拍表：1 印誰、2 列印按鈕、3 第 4 個八拍那一列的動作、4 小站位圖。" /></a
					>
					<figcaption>圖 14　八拍表。① 印誰　② 「列印」　③ 動作：大類·名稱，後面是每個人和任務角色　④ 小站位圖。</figcaption>
				</figure>
			</section>

			<section id="keys">
				<h3 class="sec">4.9 快捷鍵</h3>
				<div class="table-wrap">
					<table>
						<thead><tr><th>按鍵</th><th>做什麼</th></tr></thead>
						<tbody>
							<tr><td><kbd>空白鍵</kbd></td><td>播放／暫停（游標在輸入框裡時不行）</td></tr>
							<tr><td><kbd>⌘S</kbd>／<kbd>Ctrl+S</kbd></td><td>存檔（在輸入框裡也可以）</td></tr>
							<tr><td><kbd>Delete</kbd>（Mac：<kbd>delete</kbd>）</td><td>刪掉選到的站位或動作（不會先問）</td></tr>
							<tr><td><kbd>Esc</kbd></td><td>關掉段設定、流程設定、八拍表；都沒開時，取消選取</td></tr>
							<tr><td><kbd>Shift</kbd>＋點</td><td>在場地或泳道名字上多選隊員</td></tr>
							<tr><td>滑鼠滾輪（在場地上）</td><td>場地放大、縮小</td></tr>
						</tbody>
					</table>
				</div>
			</section>

			<!-- ───────────── 5 ───────────── -->
			<section id="cold-read">
				<h2>5 新手試跑</h2>
				<p>
					給<b>完全沒用過</b>的人。先讀完第 1–3 章，再照這一章做一次，大約 15 分鐘，<b>不需要音樂檔</b>。每一步做完，對照「你應該看到」；對不上，就照「卡住了」那一行做，或回去看括號裡的那一節。
				</p>

				<ol class="trial">
					<li>
						<label><input type="checkbox" /> <b>打開編輯器</b></label>
						<p>用 Chrome 打開 <a href={editorHref}>{editorUrl || '編輯器首頁'}</a>。如果首頁問要不要救回草稿，按「丟掉」。</p>
						<p class="see">你應該看到：首頁，右邊有「新建流程」。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>新建流程</b>（4.1）</label>
						<p>「流程名字」打「練習」。「場地」留在「9 條直放（預設）」。按「建立」。</p>
						<p class="see">
							你應該看到：編輯畫面。上方列寫「練習」，場地中間寫「場上還沒有人」，右邊欄在「隊員」分頁。場地右下角有黃色的「口號段共 0.0 秒，少於 30 秒」，先不用管（見 4.7）。
						</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>加兩個底層</b>（4.2）</label>
						<p>
							在「名字（一次加多人：一行一個）」打「阿明」，按 Enter 換行，再打「阿強」。「性別」選「男」，「全局角色」選「底層」。按「加隊員」。
						</p>
						<p class="see">你應該看到：名單有 1 阿明、2 阿強；場地下方（正面那一邊）的場地外，多了兩個圓點，寫著 1、2。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>加一個上層</b>（4.2）</label>
						<p>名字打「小美」，「性別」選「女」，「全局角色」選「上層」。按「加隊員」。</p>
						<p class="see">你應該看到：名單 3 人，場地上 3 個圓點，時間軸的泳道有 3 條。</p>
						<p class="stuck">卡住了：出現「請選性別」或「請選全局角色」，就是下拉選單還沒選。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>加一個音樂段</b>（4.3）</label>
						<p>按時間軸最左上「段」旁的「＋」，選「＋音樂段」。跳出段設定，先不載入音樂，按右上角的 × 關掉。</p>
						<p class="see">你應該看到：段列多了一個「音樂 1」長方形，寫「150 BPM」；八拍尺上有 1 到 8 的號碼。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>聽一次</b>（4.4）</label>
						<p>按上方列的圓形播放鍵。聽幾秒，再按一次停。</p>
						<p class="see">你應該聽到：每一拍「嗒」一聲（節拍器）。上方列的目前位置跟著跑。</p>
						<p class="stuck">卡住了：沒聲音，就看上方列的「節拍器」有沒有開、電腦有沒有靜音。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>排開頭的站位</b>（4.5）</label>
						<p>
							在八拍尺「1」的最左邊點一下，確認目前位置寫「音樂 1 1-1」（不是的話，再往左一點點）。把三個圓點一個一個拖到場地中間：阿明在左、阿強在右，小美在他們兩人中間、往畫面上方一點（離正面遠一點）。
						</p>
						<p class="see">你應該看到：站位列的第 1 張小圖跟著變，站位列還是只有 1 張。</p>
						<p class="stuck">卡住了：站位列出現了第 2 張小圖，表示播放頭不在 1-1。點那張多出來的小圖，按它右上角的 × 刪掉，回到這一步重做。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>排第二張站位</b>（4.5）</label>
						<p>在八拍尺上點「3」那一格的開頭，讓目前位置變成「音樂 1 3-1」（差一點沒關係）。把小美往畫面下方（靠近正面）拖。</p>
						<p class="see">你應該看到：提示「插了一張站位，大家的位置自動帶入」；站位列多了第 2 張小圖。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>看走位</b>（4.4、4.5）</label>
						<p>點八拍尺最左邊，回到開頭，按圓形播放鍵。</p>
						<p class="see">你應該看到：小美從第 1 張站位的位置，慢慢走到第 2 張站位的位置：從開頭就開始走，第 3 個八拍開始時剛好走到。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>加一個動作</b>（4.6）</label>
						<p>
							如果還在播，按播放鍵暫停（已經播完自己停了就不用按）。在八拍尺上點「4」那一格的開頭（目前位置「音樂 1 4-1」）。點右邊欄上面的「動作」分頁，在「選人」那一區按「全隊」。「大類」選「技巧」，「名稱」打「Lib」，「開始」和「長度」不用改。任務角色：阿明選「主底」、阿強選「側底」、小美選「上層」。按「新增動作」。
						</p>
						<p class="see">
							你應該看到：三條泳道在第 4 個八拍都多了一條同色的色條，阿明那條寫「技巧·Lib 主底」，另外兩條寫「側底」「上層」。場地上小美多了黃框，因為播放頭正在這個動作裡，而小美的任務角色是上層。右邊的動作表單變成這個動作的內容。
						</p>
						<p class="stuck">卡住了：動作表單下面出現紅字，照紅字的原因改。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>移動那個動作</b>（4.6）</label>
						<p>在任何一條泳道上，按住那條色條往右拖一點，放開。</p>
						<p class="see">你應該看到：三個人的色條一起移動，因為它們是同一個動作。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>看八拍表</b>（4.8）</label>
						<p>按上方列的「八拍表」。</p>
						<p class="see">你應該看到：一張表，第 4 個八拍那一列寫著「技巧·Lib：阿明（主底）、阿強（側底）、小美（上層）」；第 1、第 3 個八拍那兩列有小站位圖。看完按「關閉」。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>存檔</b>（4.8）</label>
						<p>按上方列的「存檔」。Chrome、Edge 會問存在哪裡，選一個地方存。</p>
						<p class="see">你應該看到：流程名字旁邊的「未存」不見了；電腦裡多了一個「練習.zip」。</p>
					</li>
					<li>
						<label><input type="checkbox" /> <b>重新打開</b>（4.1）</label>
						<p>按上方列的「開啟」，選剛剛的「練習.zip」。</p>
						<p class="see">你應該看到：剛剛排的流程原封不動：3 個隊員、2 張站位、1 個動作。</p>
					</li>
				</ol>

				<h3>做完了，自己考一下</h3>
				<p>答不出來，就回去看括號裡的那一節。</p>
				<div class="quiz">
					<details>
						<summary>拖人時，改的是哪一張站位？（4.5）</summary>
						<p>播放頭所在那一拍的站位。那一拍沒有站位，就自動插一張新的。</p>
					</details>
					<details>
						<summary>全局角色和任務角色差在哪？（2.1）</summary>
						<p>全局角色是整支流程固定的身分（底層或上層）；任務角色是某一個動作裡要做的事（例如主底、保護），每個動作可以不同。</p>
					</details>
					<details>
						<summary>一個動作可以從音樂 1 延續到口號 1 嗎？（4.6）</summary>
						<p>不行，動作不能跨段。要跨就拆成兩個動作，各放在一段裡。</p>
					</details>
					<details>
						<summary>草稿和流程檔差在哪？（2.1、4.8）</summary>
						<p>草稿是編輯器自動存在這台電腦的備份，不能傳給別人；流程檔是你按「存檔」得到的 .zip 檔，裡面有音樂，可以傳給隊員。</p>
					</details>
					<details>
						<summary>隊員要怎麼看你排的流程？（4.8）</summary>
						<p>把流程檔傳給他，他用電腦打開同一個編輯器，在首頁按「開啟流程檔」。或印八拍表給他。</p>
					</details>
					<details>
						<summary>音樂載入了，可是八拍尺跟音樂對不上，要調哪裡？（4.3）</summary>
						<p>段設定裡的「第一拍」和「BPM」。先在波形上點你數「1」的鼓點，再看細線有沒有一直對準鼓點；越後面越偏就是 BPM 不對。</p>
					</details>
				</div>

				<details class="maint">
					<summary>給維護這份說明的人：怎麼用這一章做冷讀測試（cold read test）</summary>
					<p>
						找一個沒看過這個編輯器的人，只給他這一頁，不在旁邊提示，請他照第 5 章做一次。他停下來、問問題、或「你應該看到」對不上的地方，就是說明或畫面要改的地方。改完再找另一個沒看過的人測一次。
					</p>
				</details>
			</section>
		</main>
	</div>
</div>

<style>
	.guide {
		min-height: 100vh;
		background: var(--paper);
		color: var(--text);
	}
	.head {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: baseline;
		gap: 14px;
		padding: 12px 24px;
		background: var(--ink);
		color: #e8ecf5;
	}
	.brand {
		color: #fff;
		font-weight: 700;
		text-decoration: none;
	}
	.brand:hover {
		text-decoration: underline;
	}
	.head-title {
		color: #9fb0d4;
	}
	.head-hint {
		margin-left: auto;
		font-size: 12px;
		color: #8b99b8;
	}

	.layout {
		display: grid;
		grid-template-columns: 220px minmax(0, 820px);
		gap: 40px;
		justify-content: center;
		padding: 32px 24px 96px;
	}
	.toc {
		position: sticky;
		top: 72px;
		align-self: start;
		max-height: calc(100vh - 96px);
		overflow-y: auto;
		font-size: 13px;
	}
	.toc b {
		display: block;
		margin-bottom: 8px;
		color: var(--muted);
		font-size: 12px;
	}
	.toc ol {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		gap: 2px;
	}
	.toc a {
		display: block;
		padding: 4px 8px;
		border-radius: var(--radius-sm);
		color: var(--text);
		text-decoration: none;
	}
	.toc a:hover {
		background: var(--surface);
	}
	.toc .sub a {
		padding-left: 20px;
		color: var(--muted);
	}

	.content {
		display: grid;
		gap: 40px;
		min-width: 0;
		font-size: 15px;
		line-height: 1.75;
	}
	.content section {
		display: grid;
		gap: 12px;
		scroll-margin-top: 72px;
	}
	.content section + section {
		padding-top: 4px;
	}
	h1 {
		font-size: 32px;
		font-weight: 800;
		color: var(--ink);
	}
	h2 {
		font-size: 24px;
		font-weight: 800;
		color: var(--ink);
		padding-bottom: 6px;
		border-bottom: 2px solid var(--mat);
	}
	h3 {
		font-size: 18px;
		font-weight: 700;
		margin-top: 8px;
	}
	h3.sec {
		font-size: 20px;
		color: var(--mat-deep);
	}
	h4 {
		margin: 10px 0 0;
		font-size: 16px;
		font-weight: 700;
	}
	p,
	ul,
	ol {
		margin: 0;
	}
	a {
		color: var(--mat);
	}
	code,
	kbd {
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.88em;
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.lead {
		gap: 16px;
	}
	.route {
		padding: 14px 18px;
		border-radius: 10px;
		background: var(--mat-soft);
		border: 1px solid #c7d8f3;
	}
	.route ul {
		margin-top: 6px;
		padding-left: 20px;
	}
	.plain {
		padding-left: 22px;
		display: grid;
		gap: 6px;
	}
	.where {
		color: var(--muted);
	}
	.purpose {
		color: var(--text);
	}
	.note {
		padding: 10px 14px;
		border-left: 3px solid var(--line);
		background: var(--surface);
		border-radius: 0 8px 8px 0;
		font-size: 14px;
		color: #3c4660;
	}
	.steps {
		padding-left: 24px;
		display: grid;
		gap: 6px;
	}
	.steps li::marker {
		font-weight: 700;
		color: var(--mat);
	}

	.table-wrap {
		overflow-x: auto;
		border-radius: 10px;
		border: 1px solid var(--line);
		background: var(--surface);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 14px;
		line-height: 1.6;
	}
	th,
	td {
		text-align: left;
		vertical-align: top;
		padding: 8px 12px;
		border-bottom: 1px solid var(--line-soft);
	}
	th {
		background: var(--surface-2);
		font-weight: 700;
		color: var(--muted);
		font-size: 13px;
	}
	td:first-child {
		white-space: nowrap;
	}
	tr.group td {
		background: var(--surface-2);
		color: var(--mat-deep);
		font-weight: 700;
		font-size: 13px;
	}
	tr:last-child td {
		border-bottom: none;
	}

	.diagram {
		margin: 8px 0;
		display: grid;
		gap: 8px;
	}
	.diagram img {
		display: block;
		width: 100%;
		height: auto;
		border-radius: 10px;
		border: 1px solid var(--line);
		background: #fff;
	}
	.shot img {
		box-shadow: 0 2px 10px rgba(22, 33, 58, 0.12);
	}
	.diagram figcaption {
		font-size: 13px;
		color: var(--muted);
	}

	.trial {
		list-style: none;
		counter-reset: trial;
		padding: 0;
		display: grid;
		gap: 12px;
	}
	.trial li {
		counter-increment: trial;
		display: grid;
		gap: 6px;
		padding: 14px 18px;
		border-radius: 10px;
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.trial label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
	}
	.trial label::before {
		content: counter(trial);
		flex: none;
		width: 24px;
		height: 24px;
		border-radius: 50%;
		background: var(--mat);
		color: #fff;
		font-size: 13px;
		font-weight: 700;
		display: grid;
		place-items: center;
	}
	.trial li:has(input:checked) {
		background: #f2faf4;
		border-color: #b9dfc3;
	}
	.see {
		color: #1f6b35;
	}
	.see,
	.stuck {
		font-size: 14px;
	}
	.stuck {
		color: var(--warn-text);
	}

	.quiz {
		display: grid;
		gap: 8px;
	}
	.quiz details {
		padding: 10px 16px;
		border-radius: 10px;
		background: var(--surface);
		border: 1px solid var(--line);
	}
	.quiz summary {
		cursor: pointer;
		font-weight: 600;
	}
	.quiz details p {
		margin-top: 6px;
		color: #3c4660;
	}

	.maint {
		margin-top: 8px;
		font-size: 13px;
		color: var(--muted);
	}
	.maint summary {
		cursor: pointer;
	}
	.maint p {
		margin-top: 6px;
	}

	@media (max-width: 960px) {
		.layout {
			grid-template-columns: minmax(0, 1fr);
			gap: 24px;
			padding: 20px 16px 64px;
		}
		.toc {
			position: static;
			max-height: none;
			padding: 12px 16px;
			border-radius: 10px;
			background: var(--surface);
			border: 1px solid var(--line);
		}
		.head-hint {
			display: none;
		}
	}

	@media print {
		.head,
		.toc {
			display: none;
		}
		.layout {
			display: block;
			padding: 0;
		}
	}
</style>
