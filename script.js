// 1. MODULE IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  updateProfile,
  sendSignInLinkToEmail,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getDatabase, 
  ref, 
  push, 
  onValue, 
  update, 
  remove, 
  set, 
  get 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
import { 
  getStorage, 
  ref as storageRef, 
  uploadBytes, 
  getDownloadURL 
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// 2. FIREBASE CONFIG & INITIALIZATION
const firebaseConfig = {
  apiKey: "AIzaSyA0BCPLt-9TvXtmPLCRq6Y45AijoUnkB48", 
  authDomain: "soroti-youth-forum.firebaseapp.com",
  projectId: "soroti-youth-forum",
  storageBucket: "soroti-youth-forum.firebasestorage.app",
  messagingSenderId: "1005832853294",
  appId: "1:1005832853294:web:bf61ea5749abf833688cbf",
  measurementId: "G-CHRVZQV6H6"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const storage = getStorage(app);

// 3. GLOBAL STATE
let postsList = [];
let currentUser = null;
let activeChatRoom = null;
let activeChatListener = null;
let notifListener = null;

let currentPostFile = null;
let currentChatFile = null;

// 4. HELPER FUNCTIONS
async function uploadMediaFile(file, folderPath) {
  if (!file) return null;
  try {
    const fileReference = storageRef(storage, `${folderPath}/${Date.now()}_${file.name}`);
    const snapshot = await uploadBytes(fileReference, file);
    return await getDownloadURL(snapshot.ref);
  } catch (error) {
    console.warn("Storage upload warning (Cloud Storage may not be enabled yet):", error);
    showToast("Cloud Storage disabled or unconfigured. Proceeding without attachment.");
    return null;
  }
}

function getInitials(name) {
  return name ? name.split(' ').map(p => p[0]).join('').toUpperCase().substring(0, 2) : 'SY';
}

function escapeHTML(str) {
  return str ? str.replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)) : '';
}

export async function sendNotification(targetUid, title, message, icon = 'fa-bell') {
  if (!targetUid) return;
  try {
    const notifRef = ref(database, `notifications/${targetUid}`);
    await push(notifRef, {
      title: title,
      message: message,
      icon: icon,
      read: false,
      createdAt: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  } catch (err) {
    console.warn("Could not dispatch notification:", err);
  }
}

function triggerDesktopPush(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "logo.png" });
  }
}

// 5. GLOBAL WINDOW HANDLERS
export async function sendEmailAuthLink(email) {
  const actionCodeSettings = {
    url: 'https://soroti-youth-forum.firebaseapp.com/finishSignUp',
    handleCodeInApp: true,
    linkDomain: 'soroti-youth-forum.firebaseapp.com'
  };

  try {
    await sendSignInLinkToEmail(auth, email, actionCodeSettings);
    window.localStorage.setItem('emailForSignIn', email);
  } catch (error) {
    console.error("Error sending auth email link:", error);
    throw error;
  }
}

window.toggleLike = async function(id) {
  if (!currentUser) return;
  const postRef = ref(database, `posts/${id}`);
  const snapshot = await get(postRef);

  if (snapshot.exists()) {
    const post = snapshot.val();
    const likeRef = ref(database, `posts/${id}/likes/${currentUser.uid}`);
    const likeSnap = await get(likeRef);

    if (likeSnap.exists()) {
      await remove(likeRef);
    } else {
      await set(likeRef, true);
      if (post.uid && post.uid !== currentUser.uid) {
        sendNotification(post.uid, currentUser.name, 'liked your post.', 'fa-heart');
      }
    }
  }
};

window.toggleDislike = async function(id) {
  if (!currentUser) return;
  const dislikeRef = ref(database, `posts/${id}/dislikes/${currentUser.uid}`);
  const snapshot = await get(dislikeRef);
  if (snapshot.exists()) {
    await remove(dislikeRef);
  } else {
    await set(dislikeRef, true);
  }
};

window.toggleCommentSection = function(id) {
  const section = document.getElementById(`commentSection-${id}`);
  if (section) section.classList.toggle('hidden');
};

window.addComment = async function(id) {
  const input = document.getElementById(`commentInput-${id}`);
  if (!input || !input.value.trim()) return;

  const postRef = ref(database, `posts/${id}`);
  const snapshot = await get(postRef);

  if (snapshot.exists()) {
    const post = snapshot.val();
    const commentsRef = ref(database, `posts/${id}/comments`);
    
    await push(commentsRef, {
      author: currentUser ? currentUser.name : 'Anonymous',
      text: input.value.trim(),
      createdAt: Date.now()
    });

    if (post.uid && currentUser && post.uid !== currentUser.uid) {
      sendNotification(post.uid, currentUser.name, 'commented on your post.', 'fa-comment');
    }
  }

  input.value = '';
};

window.deletePost = async function(id) {
  if (confirm('Are you sure you want to delete this post?')) {
    await remove(ref(database, `posts/${id}`));
  }
};

window.openChat = function(recipientUid, recipientName) {
  if (!currentUser) {
    showToast('Please log in to chat.');
    return;
  }

  const chatPopup = document.getElementById('chatPopup');
  const chatFriendName = document.getElementById('chatFriendName');
  const chatMessages = document.getElementById('chatMessages');
  if (!chatPopup) return;

  chatFriendName.textContent = `Chat with ${recipientName || 'User'}`;
  chatPopup.classList.remove('hidden');

  const roomPath = recipientUid ? [currentUser.uid, recipientUid].sort().join('_') : 'global_room';
  activeChatRoom = `direct_${roomPath}`;

  if (activeChatListener) activeChatListener();

  chatMessages.innerHTML = `<div class="chat-msg system">Connecting to conversation...</div>`;

  activeChatListener = onValue(ref(database, `chats/${activeChatRoom}`), (snapshot) => {
    const data = snapshot.val();
    chatMessages.innerHTML = `<div class="chat-msg system">Private Chat - ${escapeHTML(recipientName || 'Group')}</div>`;
    if (data) {
      Object.values(data).forEach(msg => {
        const msgEl = document.createElement('div');
        const isMe = msg.senderUid === currentUser.uid;
        msgEl.className = isMe ? 'chat-msg outgoing' : 'chat-msg system';
        
        let html = `<div>${escapeHTML(msg.text || '')}</div>`;
        if (msg.attachment) {
          html += `<div style="margin-top: 5px;"><img src="${msg.attachment}" style="max-width: 100%; max-height: 150px; border-radius: 6px; display: block;" /></div>`;
        }
        msgEl.innerHTML = html;
        chatMessages.appendChild(msgEl);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  });
};

window.openChatFromTab = function(friendUid, friendName) {
  window.openChat(friendUid, friendName);
};

function showToast(message) {
  const toastNotice = document.getElementById('toastNotice');
  if (!toastNotice) return;
  toastNotice.querySelector('span').innerHTML = message;
  toastNotice.style.display = 'flex';
  setTimeout(() => { toastNotice.style.display = 'none'; }, 4000);
}

// 6. DOM CONTROLLER
document.addEventListener('DOMContentLoaded', () => {

  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const savedTheme = localStorage.getItem('theme');
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && systemPrefersDark)) {
    document.body.classList.add('dark-theme');
    if (themeToggleBtn) themeToggleBtn.innerHTML = '<i class="fa-solid fa-sun"></i> Light Mode';
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      const isDark = document.body.classList.contains('dark-theme');
      localStorage.setItem('theme', isDark ? 'dark' : 'light');
      themeToggleBtn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i> Light Mode' : '<i class="fa-solid fa-moon"></i> Dark Mode';
    });
  }

  let isSignUpMode = false;
  let uploadedAvatarFile = null;

  const elements = {
    authScreen: document.getElementById('authScreen'),
    appContent: document.getElementById('appContent'),
    authPageForm: document.getElementById('authPageForm'),
    tabLoginBtn: document.getElementById('tabLoginBtn'),
    tabSignupBtn: document.getElementById('tabSignupBtn'),
    fullNameGroup: document.getElementById('fullNameGroup'),
    pageAuthName: document.getElementById('pageAuthName'),
    pageAuthEmail: document.getElementById('pageAuthEmail'),
    pageAuthPassword: document.getElementById('pageAuthPassword'),
    pageAuthSubmitBtn: document.getElementById('pageAuthSubmitBtn'),
    authErrorMsg: document.getElementById('authErrorMsg'),
    forgotPasswordBtn: document.getElementById('forgotPasswordBtn'),

    navDrawer: document.getElementById('navDrawer'),
    navBtns: document.querySelectorAll('.nav-btn'),
    drawerCloseBtn: document.querySelector('#navDrawer .close-btn'),
    
    profileNames: document.querySelectorAll('.profile-name'),
    profileEmails: document.querySelectorAll('.profile-email'),
    profileAvatars: document.querySelectorAll('.profile-avatar'),
    
    logoutBtns: document.querySelectorAll('.logout-btn'),
    signupBtn: document.querySelector('.signup-btn'),
    searchInput: document.getElementById('searchInput'),
    searchActionBtn: document.getElementById('searchActionBtn'),

    postText: document.getElementById('postText'),
    postPhotoInput: document.getElementById('postPhotoInput'),
    postFileInput: document.getElementById('postFileInput'),
    postBtn: document.querySelector('.post-btn'),
    postBox: document.getElementById('postBox'),
    feedContainer: document.getElementById('feedContainer'),
    fabBtn: document.getElementById('fabBtn'),
    backToTopBtn: document.getElementById('backToTopBtn'),
    toastNotice: document.getElementById('toastNotice'),
    toastClose: document.querySelector('.toast-close'),

    chatPopup: document.getElementById('chatPopup'),
    chatFriendName: document.getElementById('chatFriendName'),
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    chatFileInput: document.getElementById('chatFileInput'),
    chatSendBtn: document.getElementById('chatSendBtn'),
    chatCloseBtn: document.getElementById('chatCloseBtn'),
    chatBtns: document.querySelectorAll('.chat-btn'),
    
    callBtn: document.querySelector('.call-btn'),
    videoBtn: document.querySelector('.video-btn'),

    tabBtns: document.querySelectorAll('.tab-btn'),
    tabViews: document.querySelectorAll('.tab-view')
  };

  function init() {
    setupPreviewContainers();
    bindEvents();
    listenToAuthState();
    listenToPosts();
  }

  function listenToAuthState() {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        let userData = {};
        try {
          const userSnapshot = await get(ref(database, `users/${user.uid}`));
          if (userSnapshot.exists()) {
            userData = userSnapshot.val();
          }
        } catch (err) {
          console.warn("Could not load user profile data from Realtime Database:", err);
        }

        currentUser = {
          uid: user.uid,
          name: userData.displayName || user.displayName || user.email.split('@')[0],
          email: user.email,
          avatarUrl: userData.avatarUrl || user.photoURL || null
        };
        updateAuthView(true);
        listenToNotifications();
      } else {
        currentUser = null;
        if (notifListener) notifListener();
        updateAuthView(false);
      }
    });
  }

  function listenToNotifications() {
    if (!currentUser) return;
    const notifRef = ref(database, `notifications/${currentUser.uid}`);
    
    if (notifListener) notifListener();

    notifListener = onValue(notifRef, (snapshot) => {
      const data = snapshot.val();
      const notifList = [];
      if (data) {
        Object.keys(data).forEach(key => {
          notifList.push({ id: key, ...data[key] });
        });
        notifList.sort((a, b) => b.createdAt - a.createdAt);
      }
      renderNotifications(notifList);
    });
  }

  function renderNotifications(notifications) {
    const container = document.getElementById('notificationsContainer');
    const badgeEls = document.querySelectorAll('.notif-badge');
    
    const unreadCount = notifications.filter(n => !n.read).length;
    badgeEls.forEach(b => {
      b.textContent = unreadCount;
      b.style.display = unreadCount > 0 ? 'inline-block' : 'none';
    });

    if (!container) return;

    if (notifications.length === 0) {
      container.innerHTML = `
        <div style="padding: 20px; text-align: center; color: #888; font-size: 13px;">
          No notifications yet. You're all caught up!
        </div>`;
      return;
    }

    container.innerHTML = notifications.map(notif => `
      <div class="friend-item" style="padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.05); ${notif.read ? 'opacity: 0.6;' : 'font-weight: 600;'}">
        <span>
          <i class="fa-solid ${notif.icon || 'fa-bell'}" style="color: var(--color-red); margin-right: 6px;"></i> 
          <strong>${escapeHTML(notif.title)}</strong> ${escapeHTML(notif.message)}
        </span>
        <span style="font-size: 11px; opacity: 0.5;">${notif.time || 'Recently'}</span>
      </div>
    `).join('');
  }

  async function markAllNotificationsRead() {
    if (!currentUser) return;
    const notifRef = ref(database, `notifications/${currentUser.uid}`);
    const snapshot = await get(notifRef);
    if (snapshot.exists()) {
      const updates = {};
      Object.keys(snapshot.val()).forEach(key => {
        updates[`${key}/read`] = true;
      });
      await update(notifRef, updates);
      showToast('All notifications marked as read.');
    }
  }

  function listenToPosts() {
    const postsRef = ref(database, 'posts');
    onValue(postsRef, (snapshot) => {
      const data = snapshot.val();
      postsList = [];
      if (data) {
        Object.keys(data).forEach((key) => {
          postsList.push({ id: key, ...data[key] });
        });
        postsList.sort((a, b) => b.createdAt - a.createdAt);
      }
      renderFeed(getCurrentSearchQuery());
    }, (error) => {
      console.warn("Realtime database error reading posts:", error);
    });
  }

  function setupPreviewContainers() {
    if (elements.postBox) {
      const previewDiv = document.createElement('div');
      previewDiv.id = 'postPreviewContainer';
      previewDiv.style.cssText = 'margin-top: 10px; display: none; position: relative;';
      previewDiv.innerHTML = `
        <div style="position: relative; display: inline-block;">
          <img id="postPreviewImg" src="" style="max-height: 180px; max-width: 100%; border-radius: 8px; border: 1px solid #ddd; display: none;" />
          <div id="postPreviewFile" style="padding: 8px; background: rgba(0,0,0,0.05); border-radius: 6px; font-size: 12px; display: none;"></div>
          <button id="clearPostPreviewBtn" type="button" style="position: absolute; top: 4px; right: 4px; background: rgba(0,0,0,0.7); color: white; border: none; border-radius: 50%; width: 22px; height: 22px; cursor: pointer; font-size: 11px;"><i class="fa-solid fa-xmark"></i></button>
        </div>
      `;
      const actionsRow = elements.postBox.querySelector('.post-actions-row');
      if (actionsRow) elements.postBox.insertBefore(previewDiv, actionsRow);
    }

    if (elements.chatPopup) {
      const chatPreviewDiv = document.createElement('div');
      chatPreviewDiv.id = 'chatPreviewContainer';
      chatPreviewDiv.style.cssText = 'padding: 5px 10px; background: rgba(0,0,0,0.03); display: none; align-items: center; justify-content: space-between; font-size: 12px; border-top: 1px solid rgba(0,0,0,0.05);';
      chatPreviewDiv.innerHTML = `
        <span id="chatPreviewText" style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px;"></span>
        <button id="clearChatPreviewBtn" type="button" style="background: none; border: none; color: #888; cursor: pointer;"><i class="fa-solid fa-xmark"></i></button>
      `;
      const chatInputRow = elements.chatPopup.querySelector('.chat-input-row');
      if (chatInputRow) elements.chatPopup.insertBefore(chatPreviewDiv, chatInputRow);
    }
  }

  function getCurrentSearchQuery() {
    return elements.searchInput ? elements.searchInput.value.trim() : '';
  }

  function updateAuthView(isLoggedIn) {
    if (isLoggedIn && currentUser) {
      if (elements.authScreen) elements.authScreen.style.display = 'none';
      if (elements.appContent) {
        elements.appContent.style.display = 'block';
        elements.appContent.classList.remove('hidden');
      }
      if (elements.signupBtn) elements.signupBtn.classList.add('hidden');
      elements.logoutBtns.forEach(btn => btn.classList.remove('hidden'));
      document.querySelectorAll('.user-profile').forEach(el => el.classList.remove('hidden'));
      updateUserUI();
    } else {
      if (elements.authScreen) elements.authScreen.style.display = 'flex';
      if (elements.appContent) {
        elements.appContent.style.display = 'none';
        elements.appContent.classList.add('hidden');
      }
      if (elements.signupBtn) elements.signupBtn.classList.remove('hidden');
      elements.logoutBtns.forEach(btn => btn.classList.add('hidden'));
      document.querySelectorAll('.user-profile').forEach(el => el.classList.add('hidden'));
    }
  }

  function setAuthMode(signUp) {
    isSignUpMode = signUp;
    if (elements.authErrorMsg) elements.authErrorMsg.textContent = '';
    
    if (isSignUpMode) {
      elements.tabSignupBtn?.classList.add('active');
      elements.tabLoginBtn?.classList.remove('active');
      elements.fullNameGroup?.classList.remove('hidden');
      if (elements.pageAuthSubmitBtn) elements.pageAuthSubmitBtn.textContent = 'Create Account';
    } else {
      elements.tabLoginBtn?.classList.add('active');
      elements.tabSignupBtn?.classList.remove('active');
      elements.fullNameGroup?.classList.add('hidden');
      if (elements.pageAuthSubmitBtn) elements.pageAuthSubmitBtn.textContent = 'Log In';
    }
  }

  async function handleAuthSubmit(e) {
    e.preventDefault();
    const isSignUp = elements.tabSignupBtn?.classList.contains('active');
    
    const email = elements.pageAuthEmail.value.trim();
    const password = elements.pageAuthPassword.value.trim();
    const name = elements.pageAuthName ? elements.pageAuthName.value.trim() : '';

    if (!email || !password || (isSignUp && !name)) {
      if (elements.authErrorMsg) elements.authErrorMsg.textContent = 'Please fill in all required fields.';
      return;
    }

    try {
      if (isSignUp) {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        await updateProfile(user, { displayName: name });
        try {
          await set(ref(database, `users/${user.uid}`), { displayName: name, email: email, uid: user.uid });
        } catch (dbErr) {
          console.warn("Database user set warning:", dbErr);
        }
        showToast(`Welcome to Soroti Youth Forum, ${name}!`);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        showToast(`Welcome back!`);
      }
      elements.pageAuthEmail.value = '';
      elements.pageAuthPassword.value = '';
      if (elements.pageAuthName) elements.pageAuthName.value = '';
    } catch (error) {
      if (elements.authErrorMsg) {
        if (error.code === 'auth/invalid-credential') {
          elements.authErrorMsg.textContent = 'Incorrect email or password. If you do not have an account, click Sign Up.';
        } else if (error.code === 'auth/user-not-found') {
          elements.authErrorMsg.textContent = 'No account found with this email. Click Sign Up above to register.';
        } else if (error.code === 'auth/wrong-password') {
          elements.authErrorMsg.textContent = 'Incorrect password.';
        } else {
          elements.authErrorMsg.textContent = error.message.replace('Firebase: ', '');
        }
      }
    }
  }

  async function handleLogout() {
    if (confirm('Are you sure you want to log out?')) {
      await signOut(auth);
    }
  }

  function updateUserUI() {
    if (!currentUser) return;
    elements.profileNames.forEach(el => el.textContent = currentUser.name);
    elements.profileEmails.forEach(el => el.textContent = currentUser.email);
    
    elements.profileAvatars.forEach(el => {
      if (currentUser.avatarUrl) {
        el.style.backgroundImage = `url("${currentUser.avatarUrl}")`;
        el.style.backgroundSize = 'cover';
        el.style.backgroundPosition = 'center';
        el.textContent = '';
      } else {
        el.style.backgroundImage = 'none';
        el.textContent = getInitials(currentUser.name);
      }
    });

    const settingsAvatarPreview = document.getElementById('settingsAvatarPreview');
    if (settingsAvatarPreview) {
      if (currentUser.avatarUrl) {
        settingsAvatarPreview.style.backgroundImage = `url("${currentUser.avatarUrl}")`;
        settingsAvatarPreview.style.backgroundSize = 'cover';
        settingsAvatarPreview.style.backgroundPosition = 'center';
        settingsAvatarPreview.textContent = '';
      } else {
        settingsAvatarPreview.style.backgroundImage = 'none';
        settingsAvatarPreview.textContent = getInitials(currentUser.name);
      }
    }

    const nameInput = document.getElementById('settingsNameInput');
    const emailInput = document.getElementById('settingsEmailInput');
    if (nameInput) nameInput.value = currentUser.name;
    if (emailInput) emailInput.value = currentUser.email;
  }

  function renderFeed(filterQuery = '') {
    if (!elements.feedContainer) return;

    let displayPosts = postsList;
    if (filterQuery) {
      const q = filterQuery.toLowerCase();
      displayPosts = postsList.filter(p => (p.content && p.content.toLowerCase().includes(q)) || (p.author && p.author.toLowerCase().includes(q)));
    }

    if (displayPosts.length === 0) {
      elements.feedContainer.innerHTML = `
        <div class="card">
          <div class="animated-stripe-bar"></div>
          <h3>No posts found</h3>
          <p style="color: #888; margin-top: 8px; font-size: 14px;">Try another search term or share an update!</p>
        </div>`;
      return;
    }

    elements.feedContainer.innerHTML = displayPosts.map(post => {
      const isImage = post.attachmentType === 'image';
      const isOwner = currentUser && (currentUser.uid === post.uid || currentUser.email === post.authorEmail);
      
      const likesCount = post.likes ? Object.keys(post.likes).length : 0;
      const isLiked = post.likes && currentUser && post.likes[currentUser.uid];

      const dislikesCount = post.dislikes ? Object.keys(post.dislikes).length : 0;
      const isDisliked = post.dislikes && currentUser && post.dislikes[currentUser.uid];

      const commentsArray = post.comments ? Object.values(post.comments) : [];

      return `
        <div class="card post-card" data-id="${post.id}">
          <div class="animated-stripe-bar"></div>
          
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px;">
            <div class="friend-user">
              <div class="avatar-wrapper"><div class="avatar">${post.initials || 'SY'}</div></div>
              <div>
                <strong style="font-size: 14px; display: block;">${escapeHTML(post.author || 'Anonymous')}</strong>
                <span style="font-size: 11px; color: #888;">${post.time || 'Recently'}</span>
              </div>
            </div>
            
            ${isOwner ? `
              <div style="display: flex; gap: 8px; align-items: center;">
                <button onclick="deletePost('${post.id}')" style="background: none; border: none; color: #e50914; cursor: pointer; font-size: 14px;" title="Delete Post">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            ` : ''}
          </div>
          
          ${post.content ? `<p id="postContent-${post.id}" style="font-size: 14px; line-height: 1.5; margin-bottom: 10px;">${escapeHTML(post.content)}</p>` : ''}
          
          ${post.attachment ? (
            isImage ? 
              `<div style="margin-bottom: 12px; overflow: hidden; border-radius: 8px; border: 1px solid rgba(0,0,0,0.1); background: #000;">
                <img src="${post.attachment}" alt="Attached Photo" style="width: 100%; max-height: 400px; object-fit: contain; display: block;" />
               </div>` : 
              `<div style="margin-bottom: 12px; font-size: 12px; opacity: 0.8; background: rgba(0,0,0,0.03); padding: 8px; border-radius: 6px; border: 1px solid rgba(0,0,0,0.05);">
                <i class="fa-solid fa-paperclip"></i> Attached File: <a href="${post.attachment}" target="_blank" style="color: inherit; font-weight: bold;">${escapeHTML(post.attachmentName || 'Download Attachment')}</a>
               </div>`
          ) : ''}
          
          <div style="display: flex; gap: 15px; border-top: 1px solid rgba(0,0,0,0.05); padding-top: 10px; font-size: 13px; align-items: center;">
            <button onclick="toggleLike('${post.id}')" style="background: none; border: none; cursor: pointer; font-weight: bold; color: ${isLiked ? '#e50914' : 'inherit'};">
              ${isLiked ? '<i class="fa-solid fa-heart"></i>' : '<i class="fa-regular fa-heart"></i>'} ${likesCount}
            </button>
            <button onclick="toggleDislike('${post.id}')" style="background: none; border: none; cursor: pointer; font-weight: bold; color: ${isDisliked ? '#e50914' : 'inherit'};">
              ${isDisliked ? '<i class="fa-solid fa-thumbs-down"></i>' : '<i class="fa-regular fa-thumbs-down"></i>'} ${dislikesCount}
            </button>
            <button onclick="toggleCommentSection('${post.id}')" style="background: none; border: none; cursor: pointer; font-weight: bold; color: inherit;">
              <i class="fa-solid fa-comment"></i> Comment (${commentsArray.length})
            </button>
          </div>

          <div id="commentSection-${post.id}" class="hidden" style="margin-top: 10px; border-top: 1px dashed rgba(0,0,0,0.1); padding-top: 8px;">
            <div style="max-height: 120px; overflow-y: auto; margin-bottom: 8px;">
              ${commentsArray.map(c => `
                <div style="font-size: 12px; background: rgba(0,0,0,0.03); padding: 5px 8px; border-radius: 4px; margin-bottom: 4px;">
                  <strong>${escapeHTML(c.author)}:</strong> ${escapeHTML(c.text)}
                </div>
              `).join('')}
            </div>
            <div style="display: flex; gap: 5px;">
              <input type="text" id="commentInput-${post.id}" placeholder="Write a comment..." style="flex:1; padding: 6px; font-size: 12px; border: 1px solid #ddd; border-radius: 4px; outline: none; background: transparent; color: var(--text-color);" />
              <button onclick="addComment('${post.id}')" style="padding: 6px 10px; background: var(--color-black); color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer;"><i class="fa-solid fa-paper-plane"></i></button>
            </div>
          </div>

        </div>
      `;
    }).join('');
  }

  async function handleCreatePost() {
    const content = elements.postText.value.trim();
    if (!content && !currentPostFile) return;

    let attachmentUrl = null;
    let attachmentType = null;

    if (currentPostFile) {
      showToast('Uploading attachment...');
      attachmentUrl = await uploadMediaFile(currentPostFile, 'post_attachments');
      attachmentType = currentPostFile.type.startsWith('image/') ? 'image' : 'file';
    }

    const newPost = {
      uid: currentUser ? currentUser.uid : null,
      author: currentUser ? currentUser.name : 'Anonymous',
      authorEmail: currentUser ? currentUser.email : null,
      initials: getInitials(currentUser ? currentUser.name : 'AN'),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      createdAt: Date.now(),
      content: content,
      attachment: attachmentUrl,
      attachmentType: attachmentType,
      attachmentName: currentPostFile ? currentPostFile.name : null,
      likes: {},
      dislikes: {},
      comments: {}
    };

    await push(ref(database, 'posts'), newPost);

    elements.postText.value = '';
    if (elements.postPhotoInput) elements.postPhotoInput.value = '';
    if (elements.postFileInput) elements.postFileInput.value = '';
    clearPostPreview();

    showToast('Post published successfully!');
  }

  function clearPostPreview() {
    currentPostFile = null;
    const container = document.getElementById('postPreviewContainer');
    const img = document.getElementById('postPreviewImg');
    const fileTxt = document.getElementById('postPreviewFile');
    
    if (container) container.style.display = 'none';
    if (img) { img.src = ''; img.style.display = 'none'; }
    if (fileTxt) { fileTxt.textContent = ''; fileTxt.style.display = 'none'; }
  }

  function clearChatPreview() {
    currentChatFile = null;
    const container = document.getElementById('chatPreviewContainer');
    if (container) container.style.display = 'none';
    if (elements.chatFileInput) elements.chatFileInput.value = '';
  }

  async function sendChatMessage() {
    const text = elements.chatInput.value.trim();
    if ((!text && !currentChatFile) || !activeChatRoom) return;

    let attachmentUrl = null;
    if (currentChatFile) {
      attachmentUrl = await uploadMediaFile(currentChatFile, 'chat_attachments');
    }

    await push(ref(database, `chats/${activeChatRoom}`), {
      senderUid: currentUser ? currentUser.uid : 'anon',
      senderName: currentUser ? currentUser.name : 'Anonymous',
      text: text,
      attachment: attachmentUrl,
      timestamp: Date.now()
    });

    elements.chatInput.value = '';
    clearChatPreview();
  }

  function switchTab(targetTab) {
    if (elements.navDrawer) elements.navDrawer.classList.remove('open');

    elements.tabViews.forEach(view => view.classList.add('hidden'));
    const activeView = document.getElementById(`${targetTab}View`);
    if (activeView) activeView.classList.remove('hidden');

    elements.tabBtns.forEach(btn => {
      if (btn.getAttribute('data-tab') === targetTab) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  function bindEvents() {
    const markAllReadBtn = document.getElementById('markAllReadBtn');
    if (markAllReadBtn) {
      markAllReadBtn.addEventListener('click', markAllNotificationsRead);
    }

    const enablePushBtn = document.getElementById('enablePushBtn');
    if (enablePushBtn) {
      enablePushBtn.addEventListener('click', () => {
        if ("Notification" in window) {
          Notification.requestPermission().then(permission => {
            if (permission === "granted") {
              showToast("Desktop notifications enabled!");
              triggerDesktopPush("Soroti Youth Forum", "Desktop alerts activated successfully.");
            } else {
              showToast("Notification permission denied.");
            }
          });
        } else {
          showToast("Browser does not support desktop alerts.");
        }
      });
    }

    if (elements.tabLoginBtn) elements.tabLoginBtn.addEventListener('click', () => setAuthMode(false));
    if (elements.tabSignupBtn) elements.tabSignupBtn.addEventListener('click', () => setAuthMode(true));
    if (elements.authPageForm) elements.authPageForm.addEventListener('submit', handleAuthSubmit);
    
    const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
    if (forgotPasswordBtn) {
      forgotPasswordBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        const email = elements.pageAuthEmail.value.trim();
        if (!email) {
          if (elements.authErrorMsg) elements.authErrorMsg.textContent = 'Enter your email above to reset password.';
          return;
        }
        try {
          await sendPasswordResetEmail(auth, email);
          showToast('Password reset link sent to your email!');
        } catch (err) {
          if (elements.authErrorMsg) elements.authErrorMsg.textContent = err.message.replace('Firebase: ', '');
        }
      });
    }

    if (elements.signupBtn) {
      elements.signupBtn.addEventListener('click', () => { 
        if (elements.authScreen) elements.authScreen.style.display = 'flex';
      });
    }
    
    elements.logoutBtns.forEach(btn => btn.addEventListener('click', handleLogout));

    if (elements.navBtns) {
      elements.navBtns.forEach(btn => {
        btn.addEventListener('click', () => elements.navDrawer?.classList.add('open'));
      });
    }

    if (elements.drawerCloseBtn) {
      elements.drawerCloseBtn.addEventListener('click', () => elements.navDrawer?.classList.remove('open'));
    }

    if (elements.searchInput) {
      elements.searchInput.addEventListener('input', (e) => renderFeed(e.target.value.trim()));
    }
    
    if (elements.searchActionBtn) {
      elements.searchActionBtn.addEventListener('click', () => {
        renderFeed(getCurrentSearchQuery());
      });
    }

    if (elements.postPhotoInput) {
      elements.postPhotoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          currentPostFile = file;

          const container = document.getElementById('postPreviewContainer');
          const img = document.getElementById('postPreviewImg');
          const fileTxt = document.getElementById('postPreviewFile');

          if (container && img && fileTxt) {
            container.style.display = 'block';
            img.src = URL.createObjectURL(file);
            img.style.display = 'block';
            fileTxt.style.display = 'none';
          }
        }
      });
    }

    if (elements.postFileInput) {
      elements.postFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          currentPostFile = file;

          const container = document.getElementById('postPreviewContainer');
          const img = document.getElementById('postPreviewImg');
          const fileTxt = document.getElementById('postPreviewFile');

          if (container && img && fileTxt) {
            container.style.display = 'block';
            img.style.display = 'none';
            fileTxt.textContent = `Attached File: ${file.name}`;
            fileTxt.style.display = 'block';
          }
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (e.target.closest('#clearPostPreviewBtn')) {
        clearPostPreview();
        if (elements.postPhotoInput) elements.postPhotoInput.value = '';
        if (elements.postFileInput) elements.postFileInput.value = '';
      }
      if (e.target.closest('#clearChatPreviewBtn')) {
        clearChatPreview();
      }
    });

    if (elements.chatFileInput) {
      elements.chatFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          currentChatFile = file;

          const container = document.getElementById('chatPreviewContainer');
          const previewText = document.getElementById('chatPreviewText');

          if (container && previewText) {
            container.style.display = 'flex';
            previewText.textContent = `Attached: ${file.name}`;
          }
        }
      });
    }

    if (elements.postBtn) elements.postBtn.addEventListener('click', handleCreatePost);

    if (elements.fabBtn) {
      elements.fabBtn.addEventListener('click', () => {
        if (elements.postText) {
          elements.postText.focus();
          elements.postText.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
    }

    window.addEventListener('scroll', () => {
      if (elements.backToTopBtn) {
        if (window.scrollY > 200) {
          elements.backToTopBtn.classList.remove('hidden');
        } else {
          elements.backToTopBtn.classList.add('hidden');
        }
      }
    });

    if (elements.backToTopBtn) {
      elements.backToTopBtn.addEventListener('click', () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    }

    if (elements.toastClose) {
      elements.toastClose.addEventListener('click', () => elements.toastNotice.style.display = 'none');
    }

    elements.chatBtns.forEach(btn => {
      btn.addEventListener('click', () => window.openChat(btn.dataset.uid, btn.dataset.name));
    });

    if (elements.chatCloseBtn) {
      elements.chatCloseBtn.addEventListener('click', () => {
        elements.chatPopup.classList.add('hidden');
        if (activeChatListener) activeChatListener();
      });
    }

    if (elements.chatSendBtn) {
      elements.chatSendBtn.addEventListener('click', sendChatMessage);
    }

    if (elements.chatInput) {
      elements.chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
      });
    }
    
    if (elements.callBtn) {
      elements.callBtn.addEventListener('click', () => showToast('Voice calling feature coming soon!'));
    }
    
    if (elements.videoBtn) {
      elements.videoBtn.addEventListener('click', () => showToast('Video calling feature coming soon!'));
    }

    const profilePicInput = document.getElementById('profilePicInput');
    if (profilePicInput) {
      profilePicInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          uploadedAvatarFile = file;
          const previewEl = document.getElementById('settingsAvatarPreview');
          if (previewEl) {
            previewEl.style.backgroundImage = `url(${URL.createObjectURL(file)})`;
            previewEl.style.backgroundSize = 'cover';
            previewEl.style.backgroundPosition = 'center';
            previewEl.textContent = '';
          }
        }
      });
    }

    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', async () => {
        const newName = document.getElementById('settingsNameInput').value.trim();
        
        if (currentUser) {
          const updates = {};
          if (newName) updates.displayName = newName;
          
          if (uploadedAvatarFile) {
            showToast('Uploading profile image...');
            const avatarUrl = await uploadMediaFile(uploadedAvatarFile, 'user_avatars');
            if (avatarUrl) {
              updates.avatarUrl = avatarUrl;
              currentUser.avatarUrl = avatarUrl;
            }
          }

          try {
            await update(ref(database, `users/${currentUser.uid}`), updates);
          } catch (err) {
            console.warn("Could not save settings to database:", err);
          }
          
          if (newName) currentUser.name = newName;

          updateUserUI();
          showToast('Settings updated!');
        }
      });
    }

    document.querySelectorAll('.nav-link-item').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetTab = link.getAttribute('data-tab');
        switchTab(targetTab);
      });
    });
    
    elements.tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = e.currentTarget.getAttribute('data-tab');
        switchTab(targetTab);
      });
    });
  }

  init();
});
