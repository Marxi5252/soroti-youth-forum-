// 1. MODULE IMPORTS
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut, 
  onAuthStateChanged, 
  updateProfile,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { 
  getDatabase, 
  ref, 
  push, 
  onValue, 
  off,
  query,
  limitToLast,
  update, 
  remove, 
  set, 
  get,
  onDisconnect,
  serverTimestamp 
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
let usersList = [];
let friendsList = [];
let userBookmarks = {};
let pendingRequests = [];
let sentRequests = [];
let callHistoryList = [];
let currentUser = null;
let postsLimit = 15;
let currentPostsQueryRef = null;

let modalCurrentUid = null;
let modalPostsLimit = 5;

let activeChatRoom = null;
let activeChatRecipientUid = null;
let activeChatRecipientName = null;
let activeChatRef = null;
let activeChatCallback = null;
let activeTypingListenerRef = null;
let activeTypingListenerCallback = null;

let callHistoryRef = null;
let callHistoryCallback = null;
let friendsRef = null;
let friendsCallback = null;
let bookmarksRef = null;
let bookmarksCallback = null;
let requestsRef = null;
let requestsCallback = null;
let sentRequestsRef = null;
let sentRequestsCallback = null;
let connectedRef = null;
let connectedCallback = null;

let currentPostFile = null;
let currentChatFile = null;
let currentCallStream = null;
let callStartTime = null;
let activeCallType = 'voice';
let isAuthSignUpMode = false;

let typingTimeout = null;
let lastFocusedInput = null;

// 4. HELPER FUNCTIONS
function timeAgo(timestamp) {
  if (!timestamp) return 'Recently';
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

async function compressImage(file, maxWidth = 1000, quality = 0.75) {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob((blob) => {
          resolve(new File([blob], file.name, {
            type: file.type,
            lastModified: Date.now()
          }));
        }, file.type, quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

async function uploadMediaFile(file, folderPath) {
  if (!file) return null;
  const MAX_SIZE_BYTES = 5 * 1024 * 1024;
  if (file.size > MAX_SIZE_BYTES) {
    showToast("File size exceeds 5MB upload limit.");
    return null;
  }

  try {
    const fileToUpload = file.type.startsWith('image/') ? await compressImage(file) : file;
    const uniqueFileName = `${crypto.randomUUID()}_${fileToUpload.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const fileReference = storageRef(storage, `${folderPath}/${uniqueFileName}`);
    await uploadBytes(fileReference, fileToUpload);
    return await getDownloadURL(fileReference);
  } catch (error) {
    console.warn("Storage upload warning:", error);
    showToast("Cloud Storage upload failed.");
    return null;
  }
}

function getInitials(name) {
  return name ? name.split(' ').map(p => p[0]).join('').toUpperCase().substring(0, 2) : 'SY';
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str).replace(/[&<>'"]/g, tag => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[tag] || tag));
}

function applyAvatarStyle(element, avatarUrl, name) {
  if (!element) return;
  if (avatarUrl) {
    element.style.backgroundImage = `url("${avatarUrl}")`;
    element.style.backgroundSize = 'cover';
    element.style.backgroundPosition = 'center';
    element.textContent = '';
  } else {
    element.style.backgroundImage = 'none';
    element.textContent = getInitials(name);
  }
}

export async function sendNotification(targetUid, title, message, icon = 'fa-bell') {
  if (!targetUid) return;
  try {
    const targetNotifRef = ref(database, `notifications/${targetUid}`);
    await push(targetNotifRef, {
      title: title,
      message: message,
      icon: icon,
      read: false,
      createdAt: Date.now(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
    triggerDesktopPush(title, message);
  } catch (err) {
    console.warn("Could not dispatch notification:", err);
  }
}

function triggerDesktopPush(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "logo.png" });
  }
}

function showToast(message) {
  const toastNotice = document.getElementById('toastNotice');
  const toastText = document.getElementById('toastMsgText');
  if (!toastNotice || !toastText) return;
  toastText.innerHTML = message;
  toastNotice.style.display = 'flex';
  setTimeout(() => { toastNotice.style.display = 'none'; }, 4000);
}

function getCurrentSearchQuery() {
  const searchInput = document.getElementById('searchInput');
  return searchInput ? searchInput.value.trim() : '';
}

function setupPresenceSystem(user) {
  if (!user) return;
  
  if (connectedRef && connectedCallback) {
    off(connectedRef, 'value', connectedCallback);
  }

  connectedRef = ref(database, ".info/connected");
  const userStatusRef = ref(database, `users/${user.uid}/isOnline`);
  const userLastSeenRef = ref(database, `users/${user.uid}/lastSeen`);

  connectedCallback = (snapshot) => {
    if (snapshot.val() === false) return;
    onDisconnect(userStatusRef).set(false).then(() => {
      onDisconnect(userLastSeenRef).set(serverTimestamp());
      set(userStatusRef, true);
      set(userLastSeenRef, serverTimestamp());
    });
  };

  onValue(connectedRef, connectedCallback);
}

function detachUserListeners() {
  if (callHistoryRef && callHistoryCallback) off(callHistoryRef, 'value', callHistoryCallback);
  if (friendsRef && friendsCallback) off(friendsRef, 'value', friendsCallback);
  if (bookmarksRef && bookmarksCallback) off(bookmarksRef, 'value', bookmarksCallback);
  if (requestsRef && requestsCallback) off(requestsRef, 'value', requestsCallback);
  if (sentRequestsRef && sentRequestsCallback) off(sentRequestsRef, 'value', sentRequestsCallback);
  if (connectedRef && connectedCallback) off(connectedRef, 'value', connectedCallback);
  if (activeChatRef && activeChatCallback) off(activeChatRef, 'value', activeChatCallback);
  if (activeTypingListenerRef && activeTypingListenerCallback) off(activeTypingListenerRef, 'value', activeTypingListenerCallback);

  callHistoryRef = null; callHistoryCallback = null;
  friendsRef = null; friendsCallback = null;
  bookmarksRef = null; bookmarksCallback = null;
  requestsRef = null; requestsCallback = null;
  sentRequestsRef = null; sentRequestsCallback = null;
  connectedRef = null; connectedCallback = null;
  activeChatRef = null; activeChatCallback = null;
  activeTypingListenerRef = null; activeTypingListenerCallback = null;
}

function listenToUserSocialData(uid) {
  // Friends Listener
  friendsRef = ref(database, `friends/${uid}`);
  friendsCallback = (snapshot) => {
    const data = snapshot.val();
    friendsList = data ? Object.keys(data) : [];
    renderFriendsView();
    renderSidebarMembers();
    renderChatsView();
  };
  onValue(friendsRef, friendsCallback);

  // Incoming Friend Requests Listener
  requestsRef = ref(database, `friendRequests/${uid}`);
  requestsCallback = (snapshot) => {
    const data = snapshot.val();
    pendingRequests = data ? Object.entries(data).map(([fromUid, req]) => ({ uid: fromUid, ...req })) : [];
    renderFriendsView();
  };
  onValue(requestsRef, requestsCallback);

  // Sent Friend Requests Listener
  sentRequestsRef = ref(database, `sentRequests/${uid}`);
  sentRequestsCallback = (snapshot) => {
    const data = snapshot.val();
    sentRequests = data ? Object.keys(data) : [];
    renderFriendsView();
  };
  onValue(sentRequestsRef, sentRequestsCallback);

  // Bookmarks Listener
  bookmarksRef = ref(database, `users/${uid}/bookmarks`);
  bookmarksCallback = (snapshot) => {
    const data = snapshot.val();
    userBookmarks = data || {};
    renderFeed(getCurrentSearchQuery());
  };
  onValue(bookmarksRef, bookmarksCallback);

  // Call History Listener
  callHistoryRef = ref(database, `calls/${uid}`);
  callHistoryCallback = (snapshot) => {
    const data = snapshot.val();
    callHistoryList = data ? Object.entries(data).map(([cid, c]) => ({ id: cid, ...c })).sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0)) : [];
    renderCallHistoryView();
  };
  onValue(callHistoryRef, callHistoryCallback);
}

// 5. GLOBAL INTERACTIVE WINDOW FUNCTIONS
window.clearPostPreview = function() {
  currentPostFile = null;
  const previewContainer = document.getElementById('postPreviewContainer');
  if (previewContainer) previewContainer.style.display = 'none';
  const postPhotoInput = document.getElementById('postPhotoInput');
  const postFileInput = document.getElementById('postFileInput');
  if (postPhotoInput) postPhotoInput.value = '';
  if (postFileInput) postFileInput.value = '';
};

window.clearChatPreview = function() {
  currentChatFile = null;
  const chatPreviewContainer = document.getElementById('chatPreviewContainer');
  if (chatPreviewContainer) chatPreviewContainer.style.display = 'none';
  const chatFileInput = document.getElementById('chatFileInput');
  if (chatFileInput) chatFileInput.value = '';
};

window.navigateToPost = function(postId) {
  const profileModal = document.getElementById('profileModal');
  if (profileModal) profileModal.classList.add('hidden');

  window.switchTab('posts');

  setTimeout(() => {
    let postEl = document.getElementById(`post-${postId}`);
    if (!postEl) {
      const searchInput = document.getElementById('searchInput');
      if (searchInput && searchInput.value) searchInput.value = '';
      renderFeed('');
      postEl = document.getElementById(`post-${postId}`);
    }

    if (postEl) {
      postEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      postEl.classList.remove('highlight-post');
      void postEl.offsetWidth;
      postEl.classList.add('highlight-post');

      setTimeout(() => {
        postEl.classList.remove('highlight-post');
      }, 3000);

      showToast('Navigated to post.');
    } else {
      showToast('Post could not be located in feed.');
    }
  }, 150);
};

window.openAvatarLightbox = function(avatarUrl, userName) {
  const lightboxModal = document.getElementById('avatarLightboxModal');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxFallback = document.getElementById('lightboxFallbackAvatar');
  const lightboxName = document.getElementById('lightboxUserName');

  if (!lightboxModal) return;
  if (lightboxName) lightboxName.textContent = `${userName || 'Member'}'s Profile Picture`;

  if (avatarUrl) {
    if (lightboxImg) {
      lightboxImg.src = avatarUrl;
      lightboxImg.classList.remove('hidden');
    }
    if (lightboxFallback) lightboxFallback.classList.add('hidden');
  } else {
    if (lightboxImg) lightboxImg.classList.add('hidden');
    if (lightboxFallback) {
      lightboxFallback.classList.remove('hidden');
      lightboxFallback.style.backgroundImage = 'none';
      lightboxFallback.textContent = getInitials(userName);
    }
  }

  lightboxModal.classList.remove('hidden');
};

window.toggleBookmark = async function(button, postId) {
  if (!currentUser) {
    showToast("Please log in to bookmark posts.");
    return;
  }
  try {
    const bookmarkRef = ref(database, `users/${currentUser.uid}/bookmarks/${postId}`);
    const snapshot = await get(bookmarkRef);
    
    if (snapshot.exists()) {
      await remove(bookmarkRef);
      if (button) button.classList.remove('active');
      showToast("Bookmark removed.");
    } else {
      await set(bookmarkRef, Date.now());
      if (button) button.classList.add('active');
      showToast("Post bookmarked!");
    }
  } catch (err) {
    console.error("Failed to toggle bookmark:", err);
  }
};

window.triggerTypingStatus = function() {
  if (!currentUser || !activeChatRoom) return;
  const typingRef = ref(database, `typing/${activeChatRoom}/${currentUser.uid}`);
  set(typingRef, true);
  
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    set(typingRef, false);
  }, 2000);
};

window.toggleEmojiPicker = function(e) {
  if (e) e.stopPropagation();
  const dropdown = document.getElementById('emoji-picker-dropdown');
  if (dropdown) dropdown.classList.toggle('hidden');
};

window.insertEmoji = function(emoji) {
  const activeInput = lastFocusedInput || document.getElementById('chatInput') || document.getElementById('postText');
  if (activeInput) {
    const start = activeInput.selectionStart || 0;
    const end = activeInput.selectionEnd || 0;
    const text = activeInput.value;
    activeInput.value = text.substring(0, start) + emoji + text.substring(end);
    activeInput.selectionStart = activeInput.selectionEnd = start + emoji.length;
    activeInput.focus();
  }
  document.getElementById('emoji-picker-dropdown')?.classList.add('hidden');
};

window.markMessagesRead = async function(chatRoomId) {
  if (!currentUser || !chatRoomId) return;
  try {
    const chatRef = ref(database, `chats/${chatRoomId}`);
    const snapshot = await get(chatRef);
    if (snapshot.exists()) {
      const updates = {};
      Object.entries(snapshot.val()).forEach(([msgId, msg]) => {
        if (msg.senderUid !== currentUser.uid && !msg.read) {
          updates[`${msgId}/read`] = true;
        }
      });
      if (Object.keys(updates).length > 0) {
        await update(chatRef, updates);
      }
    }
  } catch (err) {
    console.error("Failed to mark messages read:", err);
  }
};

window.renderModalUserPosts = function() {
  const container = document.getElementById('modalUserPostsContainer');
  const badge = document.getElementById('modalPostsCountBadge');
  if (!container) return;

  const userPosts = postsList.filter(p => p.uid === modalCurrentUid);
  if (badge) badge.textContent = `${userPosts.length} posts`;

  if (userPosts.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #888; font-size: 13px; padding: 15px 0;">No posts shared yet.</div>`;
    return;
  }

  const visiblePosts = userPosts.slice(0, modalPostsLimit);

  container.innerHTML = visiblePosts.map(post => {
    const displayTime = post.createdAt ? timeAgo(post.createdAt) : (post.time || 'Recently');
    let attachmentHTML = '';
    if (post.attachment) {
      const type = post.attachmentType || '';
      if (type === 'image') {
        attachmentHTML = `<img src="${escapeHTML(post.attachment)}" style="width: 100%; max-height: 180px; object-fit: cover; border-radius: 6px; margin-top: 6px;" />`;
      } else if (type === 'video') {
        attachmentHTML = `<video src="${escapeHTML(post.attachment)}" controls style="width: 100%; max-height: 180px; border-radius: 6px; margin-top: 6px;"></video>`;
      }
    }

    return `
      <div class="modal-post-item" onclick="navigateToPost('${post.id}')" style="background: var(--item-hover-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; margin-bottom: 8px; text-align: left; cursor: pointer; transition: transform 0.2s, border-color 0.2s;">
        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; opacity: 0.7; margin-bottom: 4px;">
          <span><i class="fa-regular fa-clock"></i> ${escapeHTML(displayTime)}</span>
          <span style="color: var(--color-red); font-weight: bold;"><i class="fa-solid fa-arrow-up-right-from-square"></i> View Post</span>
        </div>
        ${post.content ? `<p style="font-size: 13px; line-height: 1.4; margin: 0;">${escapeHTML(post.content)}</p>` : ''}
        ${attachmentHTML}
      </div>
    `;
  }).join('');

  if (modalPostsLimit < userPosts.length) {
    container.innerHTML += `
      <div id="modalPostsScrollHint" style="text-align: center; font-size: 11px; color: #888; padding: 8px 0;">
        <i class="fa-solid fa-circle-notch fa-spin"></i> Scroll down to load more user posts...
      </div>
    `;
  }

  if (!container.dataset.hasScrollListener) {
    container.dataset.hasScrollListener = "true";
    container.addEventListener('scroll', () => {
      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 30) {
        const totalUserPosts = postsList.filter(p => p.uid === modalCurrentUid).length;
        if (modalPostsLimit < totalUserPosts) {
          modalPostsLimit += 5;
          window.renderModalUserPosts();
        }
      }
    });
  }
};

window.openUserProfile = function(uid) {
  let user = usersList.find(u => u.uid === uid);
  if (!user && currentUser && currentUser.uid === uid) {
    user = currentUser;
  }
  if (!user) return;

  const modal = document.getElementById('profileModal');
  const nameEl = document.getElementById('modalProfileName');
  const emailEl = document.getElementById('modalProfileEmail');
  const avatarEl = document.getElementById('modalProfileAvatar');
  const statusEl = document.getElementById('modalProfileStatus');
  const postCountEl = document.getElementById('modalProfilePostCount');
  const actionsEl = document.getElementById('modalProfileActions');

  const displayName = user.displayName || user.name || 'Member';

  if (nameEl) nameEl.textContent = displayName;
  if (emailEl) emailEl.textContent = user.email || '';
  
  applyAvatarStyle(avatarEl, user.avatarUrl, displayName);

  if (avatarEl) {
    avatarEl.onclick = () => window.openAvatarLightbox(user.avatarUrl, displayName);
  }

  if (statusEl) {
    statusEl.textContent = user.isOnline ? 'Online' : 'Offline';
    statusEl.className = `status-pill ${user.isOnline ? 'online' : 'offline'}`;
  }

  const userPosts = postsList.filter(p => p.uid === uid);
  if (postCountEl) postCountEl.textContent = userPosts.length;

  if (actionsEl && currentUser) {
    if (currentUser.uid !== uid) {
      const isFriend = friendsList.includes(uid);
      const isSent = sentRequests.includes(uid);
      const pendingReq = pendingRequests.find(req => req.uid === uid);

      let actionBtn = `<button class="chat-btn" onclick="sendFriendRequest('${uid}')"><i class="fa-solid fa-user-plus"></i> Add Friend</button>`;
      if (isFriend) {
        actionBtn = `<button class="chat-btn" onclick="removeFriend('${uid}')"><i class="fa-solid fa-user-minus"></i> Unfriend</button>`;
      } else if (pendingReq) {
        actionBtn = `<button class="chat-btn" style="background: var(--color-red); color: white;" onclick="acceptFriendRequest('${uid}', '${escapeHTML(pendingReq.fromName || displayName)}')"><i class="fa-solid fa-user-check"></i> Accept Request</button>`;
      } else if (isSent) {
        actionBtn = `<button class="chat-btn" disabled style="opacity: 0.6;"><i class="fa-solid fa-clock"></i> Request Sent</button>`;
      }

      actionsEl.innerHTML = `
        <button class="chat-btn" style="background: var(--color-red); color: white; padding: 8px 16px;" onclick="openChatFromTab('${uid}', '${escapeHTML(displayName)}')"><i class="fa-solid fa-comment"></i> Send Message</button>
        ${actionBtn}
      `;
    } else {
      actionsEl.innerHTML = `
        <button class="chat-btn" style="background: var(--color-red); color: white; padding: 8px 16px;" onclick="document.getElementById('profileModal').classList.add('hidden'); switchTab('settings');"><i class="fa-solid fa-camera"></i> Change Custom Picture</button>
      `;
    }
  }

  modalCurrentUid = uid;
  modalPostsLimit = 5;
  window.renderModalUserPosts();

  if (modal) modal.classList.remove('hidden');
};

window.startCall = function(isVideo) {
  if (!currentUser) {
    showToast("Please log in to make calls.");
    return;
  }
  activeCallType = isVideo ? 'video' : 'voice';
  const modal = document.getElementById('callModal');
  const statusText = document.getElementById('callStatusText');
  const userNameText = document.getElementById('callUserName');
  const videoPreview = document.getElementById('callVideoPreview');
  const localVideo = document.getElementById('localVideo');
  const avatarEl = document.getElementById('callAvatar');

  if (!modal) return;
  modal.classList.remove('hidden');
  
  const recipientName = activeChatRecipientName || 'Member';
  if (userNameText) userNameText.textContent = recipientName;
  if (avatarEl) avatarEl.textContent = getInitials(recipientName);

  if (statusText) statusText.textContent = isVideo ? 'Connecting Video Call...' : 'Connecting Voice Call...';
  callStartTime = Date.now();

  const constraints = isVideo ? { video: true, audio: true } : { audio: true };

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia(constraints)
      .then(stream => {
        currentCallStream = stream;
        if (isVideo && videoPreview) {
          videoPreview.classList.remove('hidden');
          if (localVideo) localVideo.srcObject = stream;
        }
        if (statusText) statusText.textContent = isVideo ? 'Video Call Connected' : 'Voice Call Connected';
      })
      .catch(err => {
        console.warn("Media device access error:", err);
        if (statusText) statusText.textContent = 'Call Active (Audio simulated)';
      });
  } else {
    if (statusText) statusText.textContent = 'Call Connected';
  }
};

window.endCall = async function() {
  const modal = document.getElementById('callModal');
  if (currentCallStream) {
    currentCallStream.getTracks().forEach(track => track.stop());
    currentCallStream = null;
  }
  if (modal) modal.classList.add('hidden');
  const videoPreview = document.getElementById('callVideoPreview');
  if (videoPreview) videoPreview.classList.add('hidden');

  if (currentUser && activeChatRecipientUid) {
    const durationSecs = callStartTime ? Math.floor((Date.now() - callStartTime) / 1000) : 0;
    const minutes = Math.floor(durationSecs / 60);
    const seconds = durationSecs % 60;
    const durationFormatted = `${minutes > 0 ? `${minutes}m ` : ''}${seconds}s`;

    try {
      const callRecordRef = push(ref(database, `calls/${currentUser.uid}`));
      await set(callRecordRef, {
        peerUid: activeChatRecipientUid,
        peerName: activeChatRecipientName || 'Member',
        type: activeCallType,
        duration: durationFormatted,
        createdAt: Date.now(),
        status: 'Completed'
      });
    } catch (err) {
      console.warn("Could not save call history:", err);
    }
  }

  showToast('Call ended.');
};

window.sendFriendRequest = async function(targetUid) {
  if (!currentUser) return;
  try {
    await set(ref(database, `friendRequests/${targetUid}/${currentUser.uid}`), {
      fromName: currentUser.displayName || currentUser.name || 'Member',
      timestamp: Date.now()
    });
    await set(ref(database, `sentRequests/${currentUser.uid}/${targetUid}`), true);
    sendNotification(targetUid, currentUser.displayName || currentUser.name, 'sent you a friend request.', 'fa-user-plus');
    showToast('Friend request sent!');
    if (modalCurrentUid === targetUid) window.openUserProfile(targetUid);
  } catch (err) {
    console.error("Failed to send friend request:", err);
  }
};

window.acceptFriendRequest = async function(senderUid, senderName) {
  if (!currentUser) return;
  try {
    const updates = {};
    updates[`friends/${currentUser.uid}/${senderUid}`] = true;
    updates[`friends/${senderUid}/${currentUser.uid}`] = true;
    updates[`friendRequests/${currentUser.uid}/${senderUid}`] = null;
    updates[`sentRequests/${senderUid}/${currentUser.uid}`] = null;
    
    await update(ref(database), updates);
    sendNotification(senderUid, currentUser.displayName || currentUser.name, 'accepted your friend request.', 'fa-user-check');
    showToast(`You are now friends with ${senderName}`);
    if (modalCurrentUid === senderUid) window.openUserProfile(senderUid);
  } catch (err) {
    console.error("Failed to accept request:", err);
  }
};

window.removeFriend = async function(friendUid) {
  if (!currentUser || !confirm('Are you sure you want to remove this friend?')) return;
  try {
    const updates = {};
    updates[`friends/${currentUser.uid}/${friendUid}`] = null;
    updates[`friends/${friendUid}/${currentUser.uid}`] = null;
    await update(ref(database), updates);
    showToast('Friend removed.');
    if (modalCurrentUid === friendUid) window.openUserProfile(friendUid);
  } catch (err) {
    console.error("Failed to remove friend:", err);
  }
};

window.toggleLike = async function(id) {
  if (!currentUser) return;
  try {
    const likeRef = ref(database, `posts/${id}/likes/${currentUser.uid}`);
    const dislikeRef = ref(database, `posts/${id}/dislikes/${currentUser.uid}`);
    const likeSnap = await get(likeRef);

    if (likeSnap.exists()) {
      await remove(likeRef);
    } else {
      await set(likeRef, true);
      await remove(dislikeRef);
      const postRef = ref(database, `posts/${id}`);
      const snapshot = await get(postRef);
      if (snapshot.exists()) {
        const post = snapshot.val();
        if (post.uid && post.uid !== currentUser.uid) {
          sendNotification(post.uid, currentUser.displayName || currentUser.name, 'liked your post.', 'fa-heart');
        }
      }
    }
  } catch (err) {
    console.error("Failed to toggle like:", err);
  }
};

window.toggleDislike = async function(id) {
  if (!currentUser) return;
  try {
    const dislikeRef = ref(database, `posts/${id}/dislikes/${currentUser.uid}`);
    const likeRef = ref(database, `posts/${id}/likes/${currentUser.uid}`);
    const snapshot = await get(dislikeRef);

    if (snapshot.exists()) {
      await remove(dislikeRef);
    } else {
      await set(dislikeRef, true);
      await remove(likeRef);
    }
  } catch (err) {
    console.error("Failed to toggle dislike:", err);
  }
};

window.toggleCommentSection = function(id) {
  const section = document.getElementById(`commentSection-${id}`);
  if (section) section.classList.toggle('hidden');
};

window.addComment = async function(id) {
  const input = document.getElementById(`commentInput-${id}`);
  if (!input || !input.value.trim()) return;

  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);

    if (snapshot.exists()) {
      const post = snapshot.val();
      const commentsRef = ref(database, `posts/${id}/comments`);
      
      await push(commentsRef, {
        author: currentUser ? (currentUser.displayName || currentUser.name) : 'Anonymous',
        uid: currentUser ? currentUser.uid : null,
        authorAvatarUrl: currentUser ? currentUser.avatarUrl : null,
        text: input.value.trim(),
        createdAt: Date.now()
      });

      if (post.uid && currentUser && post.uid !== currentUser.uid) {
        sendNotification(post.uid, currentUser.displayName || currentUser.name, 'commented on your post.', 'fa-comment');
      }
    }
    input.value = '';
  } catch (err) {
    console.error("Failed to add comment:", err);
  }
};

window.replyComment = function(postId, authorName) {
  const section = document.getElementById(`commentSection-${postId}`);
  if (section && section.classList.contains('hidden')) {
    section.classList.remove('hidden');
  }
  const input = document.getElementById(`commentInput-${postId}`);
  if (input) {
    input.value = `@${authorName} `;
    input.focus();
    input.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
};

window.toggleEditPost = function(id) {
  const displayEl = document.getElementById(`postContent-${id}`);
  const editContainer = document.getElementById(`editPostContainer-${id}`);
  if (displayEl && editContainer) {
    displayEl.classList.toggle('hidden');
    editContainer.classList.toggle('hidden');
  }
};

window.saveEditPost = async function(id) {
  const textarea = document.getElementById(`editPostInput-${id}`);
  if (!textarea) return;
  const newContent = textarea.value.trim();
  if (!newContent) {
    showToast("Post content cannot be empty.");
    return;
  }

  try {
    await update(ref(database, `posts/${id}`), {
      content: newContent,
      editedAt: Date.now(),
      isEdited: true
    });
    showToast("Post updated successfully!");
  } catch (err) {
    console.error("Failed to update post:", err);
    showToast("Failed to save changes.");
  }
};

window.deletePost = async function(id) {
  if (!currentUser) return;
  try {
    const postRef = ref(database, `posts/${id}`);
    const snapshot = await get(postRef);
    if (snapshot.exists()) {
      const post = snapshot.val();
      if (post.uid === currentUser.uid || post.authorEmail === currentUser.email) {
        if (confirm('Are you sure you want to delete this post?')) {
          await remove(postRef);
          showToast('Post deleted successfully.');
        }
      } else {
        showToast('Unauthorized: You can only delete your own posts.');
      }
    }
  } catch (err) {
    console.error("Failed to delete post:", err);
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
  const typingIndicator = document.getElementById('typing-indicator');

  if (!chatPopup) return;

  activeChatRecipientUid = recipientUid;
  activeChatRecipientName = recipientName || 'Member';

  chatFriendName.innerHTML = `<i class="fa-solid fa-grip-lines" style="margin-right: 6px; opacity: 0.6;"></i> Chat with ${escapeHTML(activeChatRecipientName)}`;
  chatPopup.classList.remove('hidden');

  const roomPath = recipientUid ? [currentUser.uid, recipientUid].sort().join('_') : 'global_room';
  activeChatRoom = `direct_${roomPath}`;

  if (activeChatRef && activeChatCallback) off(activeChatRef, 'value', activeChatCallback);
  if (activeTypingListenerRef && activeTypingListenerCallback) off(activeTypingListenerRef, 'value', activeTypingListenerCallback);

  chatMessages.innerHTML = `<div class="chat-msg system">Private Chat - ${escapeHTML(activeChatRecipientName)}</div>`;

  activeTypingListenerRef = ref(database, `typing/${activeChatRoom}`);
  activeTypingListenerCallback = (snap) => {
    if (!typingIndicator) return;
    const data = snap.val() || {};
    const isSomeoneElseTyping = Object.keys(data).some(uid => uid !== currentUser.uid && data[uid] === true);
    typingIndicator.style.display = isSomeoneElseTyping ? 'flex' : 'none';
  };
  onValue(activeTypingListenerRef, activeTypingListenerCallback);

  activeChatRef = ref(database, `chats/${activeChatRoom}`);
  activeChatCallback = (snapshot) => {
    const data = snapshot.val();
    chatMessages.innerHTML = `<div class="chat-msg system">Private Chat - ${escapeHTML(activeChatRecipientName)}</div>`;
    if (data) {
      let hasUnread = false;
      Object.entries(data).forEach(([msgId, msg]) => {
        if (msg.senderUid !== currentUser.uid && !msg.read) hasUnread = true;

        const msgEl = document.createElement('div');
        const isMe = msg.senderUid === currentUser.uid;
        msgEl.className = isMe ? 'chat-msg outgoing' : 'chat-msg incoming';
        
        let html = `<div>${escapeHTML(msg.text || '')}`;
        if (isMe) {
          html += ` <span class="read-receipt" data-message-id="${msgId}"><i class="fa-solid fa-check-double ${msg.read ? 'text-blue-500' : ''}"></i></span>`;
        }
        html += `</div>`;
        
        if (msg.attachment) {
          const isImg = (msg.attachmentType === 'image') || msg.attachment.match(/\.(jpeg|jpg|gif|png|webp)($|\?)/i);
          if (isImg) {
            html += `<div style="margin-top: 5px;"><img src="${escapeHTML(msg.attachment)}" style="max-width: 100%; max-height: 150px; border-radius: 6px; display: block; object-fit: cover;" /></div>`;
          } else {
            html += `
              <div style="margin-top: 5px; background: rgba(0,0,0,0.1); padding: 6px 10px; border-radius: 6px; font-size: 12px;">
                <a href="${escapeHTML(msg.attachment)}" target="_blank" download style="color: inherit; font-weight: bold; text-decoration: underline; display: flex; align-items: center; gap: 6px;">
                  <i class="fa-solid fa-file-arrow-down"></i> ${escapeHTML(msg.attachmentName || 'Download Attachment')}
                </a>
              </div>`;
          }
        }
        msgEl.innerHTML = html;
        chatMessages.appendChild(msgEl);
      });
      chatMessages.scrollTop = chatMessages.scrollHeight;

      if (hasUnread) window.markMessagesRead(activeChatRoom);
    }
  };

  onValue(activeChatRef, activeChatCallback);
};

window.openChatFromTab = function(friendUid, friendName) {
  document.getElementById('profileModal')?.classList.add('hidden');
  window.openChat(friendUid, friendName);
};

window.switchTab = function(tabName) {
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabViews = document.querySelectorAll('.tab-view');
  
  tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tabName));
  tabViews.forEach(view => {
    if (view.id === `${tabName}View`) view.classList.remove('hidden');
    else view.classList.add('hidden');
  });
};

// 6. REALTIME LISTENERS & RENDERING
function listenToPosts() {
  if (currentPostsQueryRef) off(currentPostsQueryRef);
  const postsRef = ref(database, 'posts');
  currentPostsQueryRef = query(postsRef, limitToLast(postsLimit));

  onValue(currentPostsQueryRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      postsList = Object.entries(data).map(([id, post]) => ({ id, ...post })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } else {
      postsList = [];
    }
    renderFeed(getCurrentSearchQuery());
  });
}

function listenToUsers() {
  const usersRef = ref(database, 'users');
  onValue(usersRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      usersList = Object.entries(data).map(([uid, u]) => ({ uid, ...u }));
    } else {
      usersList = [];
    }
    renderFeed(getCurrentSearchQuery());
    renderSidebarMembers();
    renderFriendsView();
    renderChatsView();
  });
}

function renderSidebarMembers() {
  const sidebarContainer = document.getElementById('sidebarMembersContainer');
  if (!sidebarContainer) return;

  const onlineFriends = usersList.filter(u => currentUser && friendsList.includes(u.uid) && u.isOnline);
  if (onlineFriends.length === 0) {
    sidebarContainer.innerHTML = `<p style="font-size: 11px; color: #888;">No friends active right now.</p>`;
    return;
  }

  sidebarContainer.innerHTML = onlineFriends.map(user => `
    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; cursor: pointer;" onclick="openChatFromTab('${user.uid}', '${escapeHTML(user.displayName || user.name)}')">
      <div style="display: flex; align-items: center; gap: 8px;">
        <div class="avatar profile-avatar online" style="width: 26px; height: 26px; font-size: 10px; ${user.avatarUrl ? `background-image: url('${user.avatarUrl}'); background-size: cover; background-position: center;` : ''}">${!user.avatarUrl ? getInitials(user.displayName || user.name) : ''}</div>
        <span style="font-size: 12px; font-weight: 500; color: var(--text-color);">${escapeHTML(user.displayName || user.name)}</span>
      </div>
      <span style="width: 8px; height: 8px; background: #2ec4b6; border-radius: 50%;"></span>
    </div>
  `).join('');
}

function renderFeed(filter = '') {
  const container = document.getElementById('feedContainer');
  if (!container) return;

  const queryText = filter.toLowerCase().trim();
  const filteredPosts = postsList.filter(post => {
    if (!queryText) return true;
    const author = (post.authorName || post.author || '').toLowerCase();
    const content = (post.content || '').toLowerCase();
    return author.includes(queryText) || content.includes(queryText);
  });

  if (filteredPosts.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #888; padding: 20px 0; font-size: 13px;">No posts found matching your search.</div>`;
    return;
  }

  container.innerHTML = filteredPosts.map(post => {
    const authorName = post.authorName || post.author || 'Youth Member';
    const authorAvatarUrl = post.authorAvatarUrl || null;
    const isOwner = currentUser && (post.uid === currentUser.uid || post.authorEmail === currentUser.email);
    const isBookmarked = userBookmarks[post.id] !== undefined;

    const likesCount = post.likes ? Object.keys(post.likes).length : 0;
    const dislikesCount = post.dislikes ? Object.keys(post.dislikes).length : 0;
    const isLiked = currentUser && post.likes && post.likes[currentUser.uid];
    const isDisliked = currentUser && post.dislikes && post.dislikes[currentUser.uid];

    const commentsArr = post.comments ? Object.entries(post.comments).map(([cid, c]) => ({ id: cid, ...c })) : [];
    const commentsCount = commentsArr.length;

    const postUser = usersList.find(u => u.uid === post.uid);
    const isOnline = postUser ? postUser.isOnline : false;

    let attachmentMarkup = '';
    if (post.attachment) {
      const type = post.attachmentType || '';
      if (type === 'image') {
        attachmentMarkup = `<div class="media-attachment-container"><img src="${escapeHTML(post.attachment)}" style="width: 100%; max-height: 350px; object-fit: cover;" /></div>`;
      } else if (type === 'video') {
        attachmentMarkup = `<div class="media-attachment-container"><video src="${escapeHTML(post.attachment)}" controls style="width: 100%; max-height: 350px;"></video></div>`;
      } else if (type === 'audio') {
        attachmentMarkup = `<div class="media-attachment-container"><audio src="${escapeHTML(post.attachment)}" controls></audio></div>`;
      } else {
        attachmentMarkup = `
          <div style="margin-bottom: 12px; background: var(--item-hover-bg); padding: 10px; border-radius: 6px; font-size: 13px;">
            <a href="${escapeHTML(post.attachment)}" target="_blank" download style="color: var(--color-red); font-weight: bold; text-decoration: underline;">
              <i class="fa-solid fa-file-arrow-down"></i> ${escapeHTML(post.attachmentName || 'Download File Attachment')}
            </a>
          </div>`;
      }
    }

    const commentsListHTML = commentsArr.map(comment => {
      const commentUser = comment.uid ? usersList.find(u => u.uid === comment.uid) : null;
      const commentAvatar = commentUser?.avatarUrl || comment.authorAvatarUrl || null;
      const commentAuthorName = commentUser?.displayName || comment.author || 'Youth Member';
      const commentUid = comment.uid || '';
      const avatarInitials = getInitials(commentAuthorName);
      const avatarStyle = commentAvatar ? `background-image: url('${commentAvatar}'); background-size: cover; background-position: center;` : '';
      const clickHandlerAttr = commentUid ? `onclick="openUserProfile('${commentUid}')"` : '';

      return `
        <div style="display: flex; gap: 10px; margin-top: 10px; align-items: flex-start;">
          <div class="avatar comment-avatar" ${clickHandlerAttr} style="${avatarStyle}" title="Click to view profile">
            ${!commentAvatar ? avatarInitials : ''}
          </div>
          <div style="background: var(--item-hover-bg); border-radius: 8px; padding: 8px 12px; flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span class="comment-author-name" ${clickHandlerAttr} title="Click to view profile">${escapeHTML(commentAuthorName)}</span>
              <span style="font-size: 10px; opacity: 0.6;">${timeAgo(comment.createdAt)}</span>
            </div>
            <p style="font-size: 12px; margin-top: 4px; line-height: 1.3;">${escapeHTML(comment.text)}</p>
            <div style="margin-top: 4px; text-align: right;">
              <button style="background: none; border: none; color: var(--color-red); font-size: 11px; cursor: pointer; font-weight: bold;" onclick="replyComment('${post.id}', '${escapeHTML(commentAuthorName)}')">
                <i class="fa-solid fa-reply"></i> Reply
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    const postTimeFormatted = post.createdAt ? timeAgo(post.createdAt) : (post.time || 'Recently');

    return `
      <div class="card" id="post-${post.id}">
        <div class="animated-stripe-bar"></div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div style="display: flex; align-items: center; gap: 10px; cursor: pointer;" onclick="openUserProfile('${post.uid}')">
            <div class="avatar profile-avatar ${isOnline ? 'online' : ''}" style="${authorAvatarUrl ? `background-image: url('${authorAvatarUrl}'); background-size: cover; background-position: center;` : ''}">
              ${!authorAvatarUrl ? getInitials(authorName) : ''}
            </div>
            <div>
              <h4 style="font-size: 14px; margin: 0; font-weight: bold; color: var(--text-color);">${escapeHTML(authorName)}</h4>
              <span style="font-size: 11px; opacity: 0.6;">${escapeHTML(postTimeFormatted)}${post.isEdited ? ' (edited)' : ''}</span>
            </div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="bookmark-btn ${isBookmarked ? 'active' : ''}" onclick="toggleBookmark(this, '${post.id}')" title="Bookmark Post"><i class="fa-solid fa-bookmark"></i></button>
            ${isOwner ? `<button style="background: none; border: none; color: var(--text-color); opacity: 0.6; cursor: pointer;" onclick="toggleEditPost('${post.id}')" title="Edit Post"><i class="fa-solid fa-pen"></i></button>` : ''}
            ${isOwner ? `<button style="background: none; border: none; color: var(--color-red); cursor: pointer;" onclick="deletePost('${post.id}')" title="Delete Post"><i class="fa-solid fa-trash"></i></button>` : ''}
          </div>
        </div>

        <div id="postContent-${post.id}">
          ${post.content ? `<p style="font-size: 14px; line-height: 1.5; margin-bottom: 12px;">${escapeHTML(post.content)}</p>` : ''}
        </div>

        <div id="editPostContainer-${post.id}" class="hidden" style="margin-bottom: 12px;">
          <textarea id="editPostInput-${post.id}" style="width: 100%; padding: 8px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-color); font-size: 13px;">${escapeHTML(post.content || '')}</textarea>
          <div style="display: flex; gap: 8px; margin-top: 6px; justify-content: flex-end;">
            <button class="chat-btn" onclick="toggleEditPost('${post.id}')">Cancel</button>
            <button class="post-btn" onclick="saveEditPost('${post.id}')">Save</button>
          </div>
        </div>

        ${attachmentMarkup}

        <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--border-color); padding-top: 10px; margin-top: 10px;">
          <div style="display: flex; gap: 12px;">
            <button style="background: none; border: none; cursor: pointer; color: ${isLiked ? 'var(--color-red)' : 'var(--text-color)'}; font-weight: bold; font-size: 13px;" onclick="toggleLike('${post.id}')">
              <i class="fa-solid fa-thumbs-up"></i> ${likesCount}
            </button>
            <button style="background: none; border: none; cursor: pointer; color: ${isDisliked ? 'var(--color-red)' : 'var(--text-color)'}; font-weight: bold; font-size: 13px;" onclick="toggleDislike('${post.id}')">
              <i class="fa-solid fa-thumbs-down"></i> ${dislikesCount}
            </button>
            <button style="background: none; border: none; cursor: pointer; color: var(--text-color); font-weight: bold; font-size: 13px;" onclick="toggleCommentSection('${post.id}')">
              <i class="fa-solid fa-comment"></i> ${commentsCount}
            </button>
          </div>
        </div>

        <div id="commentSection-${post.id}" class="hidden" style="margin-top: 12px; border-top: 1px solid var(--border-color); padding-top: 10px;">
          <div style="display: flex; gap: 8px;">
            <input type="text" id="commentInput-${post.id}" placeholder="Write a comment..." style="flex: 1; padding: 8px 12px; border: 1px solid var(--border-color); border-radius: 20px; outline: none; font-size: 12px; background: var(--card-bg); color: var(--text-color);" />
            <button class="post-btn" style="padding: 6px 14px; border-radius: 20px; font-size: 12px;" onclick="addComment('${post.id}')">Send</button>
          </div>
          <div id="commentsContainer-${post.id}">
            ${commentsListHTML}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderChatsView() {
  const container = document.getElementById('chatsListContainer');
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = `<div style="text-align: center; color: #888; font-size: 13px; padding: 15px 0;">Log in to view chat messages.</div>`;
    return;
  }

  const friends = usersList.filter(u => friendsList.includes(u.uid));
  if (friends.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #888; font-size: 13px; padding: 15px 0;">No active friend chats yet. Add friends from the "Friends" tab to start messaging.</div>`;
    return;
  }

  container.innerHTML = friends.map(friend => {
    const name = friend.displayName || friend.name || 'Youth Member';
    const isOnline = friend.isOnline;
    return `
      <div class="friend-item" style="padding: 10px 0; border-bottom: 1px solid var(--border-color);">
        <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${friend.uid}')">
          <div class="avatar profile-avatar ${isOnline ? 'online' : ''}" style="${friend.avatarUrl ? `background-image: url('${friend.avatarUrl}'); background-size: cover; background-position: center;` : ''}">
            ${!friend.avatarUrl ? getInitials(name) : ''}
          </div>
          <div>
            <h4 style="font-size: 14px; margin: 0; font-weight: bold; color: var(--text-color);">${escapeHTML(name)}</h4>
            <span style="font-size: 11px; color: ${isOnline ? '#2ec4b6' : '#888'}; font-weight: 500;">
              ${isOnline ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
        <button class="post-btn" style="padding: 6px 14px; font-size: 12px;" onclick="openChat('${friend.uid}', '${escapeHTML(name)}')">
          <i class="fa-solid fa-comment"></i> Chat
        </button>
      </div>
    `;
  }).join('');
}

function renderFriendsView() {
  const container = document.getElementById('friendsListContainer');
  if (!container) return;

  if (!currentUser) {
    container.innerHTML = `<div style="text-align: center; color: #888; font-size: 13px; padding: 15px 0;">Log in to connect with Soroti Youth.</div>`;
    return;
  }

  let requestsHTML = '';
  if (pendingRequests.length > 0) {
    requestsHTML = `
      <div style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid var(--border-color);">
        <h4 style="font-size: 14px; margin-bottom: 10px; color: var(--color-red);"><i class="fa-solid fa-user-clock"></i> Incoming Requests (${pendingRequests.length})</h4>
        ${pendingRequests.map(req => {
          const reqUser = usersList.find(u => u.uid === req.uid);
          const reqName = reqUser?.displayName || req.fromName || 'Youth Member';
          return `
            <div class="friend-item" style="padding: 8px 0;">
              <div class="friend-user" onclick="openUserProfile('${req.uid}')" style="cursor: pointer;">
                <div class="avatar profile-avatar" style="${reqUser?.avatarUrl ? `background-image: url('${reqUser.avatarUrl}'); background-size: cover; background-position: center;` : ''}">
                  ${!reqUser?.avatarUrl ? getInitials(reqName) : ''}
                </div>
                <div>
                  <h5 style="font-size: 13px; margin: 0; font-weight: bold;">${escapeHTML(reqName)}</h5>
                  <span style="font-size: 10px; opacity: 0.6;">Wants to connect</span>
                </div>
              </div>
              <button class="post-btn" style="padding: 6px 12px; font-size: 12px;" onclick="acceptFriendRequest('${req.uid}', '${escapeHTML(reqName)}')">
                <i class="fa-solid fa-user-check"></i> Accept
              </button>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  const otherUsers = usersList.filter(u => u.uid !== currentUser.uid);

  if (otherUsers.length === 0 && pendingRequests.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #888; font-size: 13px; padding: 15px 0;">No other network members found yet.</div>`;
    return;
  }

  const membersHTML = `
    <div>
      <h4 style="font-size: 14px; margin-bottom: 10px;"><i class="fa-solid fa-users"></i> Youth Community Members</h4>
      ${otherUsers.map(user => {
        const name = user.displayName || user.name || 'Youth Member';
        const isFriend = friendsList.includes(user.uid);
        const isSent = sentRequests.includes(user.uid);
        const pendingReq = pendingRequests.find(r => r.uid === user.uid);

        let actionBtn = `<button class="chat-btn" onclick="sendFriendRequest('${user.uid}')"><i class="fa-solid fa-user-plus"></i> Add Friend</button>`;
        if (isFriend) {
          actionBtn = `<button class="post-btn" style="padding: 6px 12px; font-size: 12px;" onclick="openChat('${user.uid}', '${escapeHTML(name)}')"><i class="fa-solid fa-comment"></i> Chat</button>`;
        } else if (pendingReq) {
          actionBtn = `<button class="post-btn" style="padding: 6px 12px; font-size: 12px;" onclick="acceptFriendRequest('${user.uid}', '${escapeHTML(name)}')"><i class="fa-solid fa-user-check"></i> Accept</button>`;
        } else if (isSent) {
          actionBtn = `<button class="chat-btn" disabled style="opacity: 0.6;"><i class="fa-solid fa-clock"></i> Sent</button>`;
        }

        return `
          <div class="friend-item" style="padding: 10px 0; border-bottom: 1px solid var(--border-color);">
            <div class="friend-user" style="cursor: pointer;" onclick="openUserProfile('${user.uid}')">
              <div class="avatar profile-avatar ${user.isOnline ? 'online' : ''}" style="${user.avatarUrl ? `background-image: url('${user.avatarUrl}'); background-size: cover; background-position: center;` : ''}">
                ${!user.avatarUrl ? getInitials(name) : ''}
              </div>
              <div>
                <h4 style="font-size: 14px; margin: 0; font-weight: bold; color: var(--text-color);">${escapeHTML(name)}</h4>
                <span style="font-size: 11px; opacity: 0.6;">${escapeHTML(user.district || 'Soroti')}</span>
              </div>
            </div>
            ${actionBtn}
          </div>
        `;
      }).join('')}
    </div>
  `;

  container.innerHTML = requestsHTML + membersHTML;
}

function renderCallHistoryView() {
  const container = document.getElementById('callHistoryContainer');
  if (!container) return;

  if (callHistoryList.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: #888; font-size: 13px; padding: 15px 0;">No call records found.</div>`;
    return;
  }

  container.innerHTML = callHistoryList.map(call => `
    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid var(--border-color);">
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="width: 36px; height: 36px; border-radius: 50%; background: var(--item-hover-bg); display: flex; align-items: center; justify-content: center; color: var(--color-red);">
          <i class="fa-solid fa-${call.type === 'video' ? 'video' : 'phone'}"></i>
        </div>
        <div>
          <h5 style="font-size: 13px; margin: 0; font-weight: bold; color: var(--text-color);">${escapeHTML(call.peerName || 'Member')}</h5>
          <span style="font-size: 11px; opacity: 0.6;">${timeAgo(call.createdAt)} &bull; Duration: ${call.duration || '0s'}</span>
        </div>
      </div>
      <span style="font-size: 11px; font-weight: bold; color: var(--color-red);">${escapeHTML(call.status || 'Completed')}</span>
    </div>
  `).join('');
}

// 7. INITIALIZATION & EVENT LISTENERS
document.addEventListener('DOMContentLoaded', () => {

  // Auth Tabs (Log In vs Sign Up)
  const tabLoginBtn = document.getElementById('tabLoginBtn');
  const tabSignupBtn = document.getElementById('tabSignupBtn');
  const authSubmitBtn = document.getElementById('pageAuthSubmitBtn');
  const fullNameGroup = document.getElementById('fullNameGroup');
  const phoneGroup = document.getElementById('phoneGroup');
  const districtGroup = document.getElementById('districtGroup');
  const villageGroup = document.getElementById('villageGroup');
  const authRedirectBtn = document.getElementById('authRedirectBtn');
  const authErrorMsg = document.getElementById('authErrorMsg');

  const setAuthMode = (signUp) => {
    isAuthSignUpMode = signUp;
    authErrorMsg.textContent = '';
    if (signUp) {
      tabSignupBtn.classList.add('active');
      tabLoginBtn.classList.remove('active');
      fullNameGroup?.classList.remove('hidden');
      phoneGroup?.classList.remove('hidden');
      districtGroup?.classList.remove('hidden');
      villageGroup?.classList.remove('hidden');
      if (authSubmitBtn) authSubmitBtn.textContent = 'Sign Up';
    } else {
      tabLoginBtn.classList.add('active');
      tabSignupBtn.classList.remove('active');
      fullNameGroup?.classList.add('hidden');
      phoneGroup?.classList.add('hidden');
      districtGroup?.classList.add('hidden');
      villageGroup?.classList.add('hidden');
      if (authSubmitBtn) authSubmitBtn.textContent = 'Log In';
    }
  };

  tabLoginBtn?.addEventListener('click', (e) => { e.preventDefault(); setAuthMode(false); });
  tabSignupBtn?.addEventListener('click', (e) => { e.preventDefault(); setAuthMode(true); });
  authRedirectBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMode(!isAuthSignUpMode);
  });

  // Forgot Password
  document.getElementById('forgotPasswordBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('pageAuthEmail')?.value.trim();
    if (!email) {
      if (authErrorMsg) authErrorMsg.textContent = 'Please enter your email address first.';
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      showToast('Password reset link sent to your email.');
    } catch (err) {
      if (authErrorMsg) authErrorMsg.textContent = err.message;
    }
  });

  // Form Submit (Auth)
  document.getElementById('authPageForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('pageAuthEmail').value.trim();
    const password = document.getElementById('pageAuthPassword').value.trim();

    if (authErrorMsg) authErrorMsg.textContent = '';

    try {
      if (isAuthSignUpMode) {
        const name = document.getElementById('pageAuthName').value.trim();
        const phone = document.getElementById('pageAuthPhone').value.trim();
        const district = document.getElementById('pageAuthDistrict').value.trim();
        const village = document.getElementById('pageAuthVillage').value.trim();

        if (!name) {
          if (authErrorMsg) authErrorMsg.textContent = 'Full Name is required.';
          return;
        }

        const cred = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(cred.user, { displayName: name });

        await set(ref(database, `users/${cred.user.uid}`), {
          displayName: name,
          name: name,
          email: email,
          phone: phone,
          district: district || 'Soroti',
          village: village,
          isOnline: true,
          createdAt: Date.now()
        });

        showToast('Account created successfully!');
      } else {
        await signInWithEmailAndPassword(auth, email, password);
        showToast('Logged in successfully!');
      }
    } catch (err) {
      if (authErrorMsg) authErrorMsg.textContent = err.message.replace('Firebase: ', '');
    }
  });

  // Auth State Listener
  onAuthStateChanged(auth, async (user) => {
    const authScreen = document.getElementById('authScreen');
    const appContent = document.getElementById('appContent');
    const topBarUserProfile = document.getElementById('topBarUserProfile');
    const topBarAuthBtn = document.getElementById('topBarAuthBtn');
    const topBarUserName = document.getElementById('topBarUserName');
    const topBarAvatar = document.getElementById('topBarProfileAvatar');
    const drawerProfileInfo = document.getElementById('drawerProfileInfo');

    if (user) {
      authScreen?.classList.add('hidden');
      appContent?.classList.remove('hidden');

      const userRef = ref(database, `users/${user.uid}`);
      const snap = await get(userRef);
      const dbUserData = snap.exists() ? snap.val() : {};

      currentUser = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName || dbUserData.name || 'Youth Member',
        name: user.displayName || dbUserData.name || 'Youth Member',
        avatarUrl: dbUserData.avatarUrl || null,
        district: dbUserData.district || 'Soroti'
      };

      if (topBarUserProfile) topBarUserProfile.classList.remove('hidden');
      if (topBarAuthBtn) topBarAuthBtn.classList.add('hidden');
      if (topBarUserName) topBarUserName.textContent = currentUser.displayName;
      applyAvatarStyle(topBarAvatar, currentUser.avatarUrl, currentUser.displayName);

      if (drawerProfileInfo) {
        const nameEl = drawerProfileInfo.querySelector('.profile-name');
        const emailEl = drawerProfileInfo.querySelector('.profile-email');
        const avatarEl = document.getElementById('drawerProfileAvatar');
        if (nameEl) nameEl.textContent = currentUser.displayName;
        if (emailEl) emailEl.textContent = currentUser.email;
        applyAvatarStyle(avatarEl, currentUser.avatarUrl, currentUser.displayName);
      }

      const settingsNameInput = document.getElementById('settingsNameInput');
      const settingsEmailInput = document.getElementById('settingsEmailInput');
      if (settingsNameInput) settingsNameInput.value = currentUser.displayName;
      if (settingsEmailInput) settingsEmailInput.value = currentUser.email;

      setupPresenceSystem(currentUser);
      listenToPosts();
      listenToUsers();
      listenToUserSocialData(currentUser.uid);
    } else {
      detachUserListeners();
      currentUser = null;
      authScreen?.classList.remove('hidden');
      appContent?.classList.add('hidden');
      if (topBarUserProfile) topBarUserProfile.classList.add('hidden');
      if (topBarAuthBtn) topBarAuthBtn.classList.remove('hidden');
    }
  });

  // Logout Button
  document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    if (currentUser) {
      await set(ref(database, `users/${currentUser.uid}/isOnline`), false);
      await signOut(auth);
      showToast('Logged out successfully.');
    }
  });

  // Navigation Drawer
  const navDrawer = document.getElementById('navDrawer');
  const drawerOverlay = document.getElementById('drawerOverlay');

  const openDrawer = () => {
    navDrawer?.classList.add('open');
    drawerOverlay?.classList.add('active');
  };
  const closeDrawer = () => {
    navDrawer?.classList.remove('open');
    drawerOverlay?.classList.remove('active');
  };

  document.getElementById('navDrawerOpenBtn')?.addEventListener('click', openDrawer);
  document.getElementById('drawerCloseBtn')?.addEventListener('click', closeDrawer);
  drawerOverlay?.addEventListener('click', closeDrawer);

  document.querySelectorAll('.nav-link-item').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = link.dataset.tab;
      if (tab) window.switchTab(tab);
      closeDrawer();
    });
  });

  // Action Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      window.switchTab(btn.dataset.tab);
    });
  });

  // FAB Speed Dial Options
  const fabBtn = document.getElementById('fabBtn');
  const fabOptions = document.getElementById('fabOptions');
  fabBtn?.addEventListener('click', () => {
    fabBtn.classList.toggle('active');
    fabOptions?.classList.toggle('hidden');
  });

  document.getElementById('fabChatBtn')?.addEventListener('click', () => {
    window.switchTab('chats');
    fabOptions?.classList.add('hidden');
    fabBtn?.classList.remove('active');
  });

  document.getElementById('fabCreatePostBtn')?.addEventListener('click', () => {
    window.switchTab('posts');
    document.getElementById('postText')?.focus();
    fabOptions?.classList.add('hidden');
    fabBtn?.classList.remove('active');
  });

  // Media Attachment Previews for Creating Post
  const handlePostFileSelect = (file) => {
    if (!file) return;
    currentPostFile = file;
    const previewContainer = document.getElementById('postPreviewContainer');
    const previewImg = document.getElementById('postPreviewImg');
    const previewVid = document.getElementById('postPreviewVid');
    const previewAud = document.getElementById('postPreviewAud');
    const previewFile = document.getElementById('postPreviewFile');

    if (previewImg) previewImg.style.display = 'none';
    if (previewVid) previewVid.style.display = 'none';
    if (previewAud) previewAud.style.display = 'none';
    if (previewFile) previewFile.style.display = 'none';

    const objectUrl = URL.createObjectURL(file);
    if (file.type.startsWith('image/')) {
      if (previewImg) { previewImg.src = objectUrl; previewImg.style.display = 'block'; }
    } else if (file.type.startsWith('video/')) {
      if (previewVid) { previewVid.src = objectUrl; previewVid.style.display = 'block'; }
    } else if (file.type.startsWith('audio/')) {
      if (previewAud) { previewAud.src = objectUrl; previewAud.style.display = 'block'; }
    } else {
      if (previewFile) { previewFile.textContent = `Attached: ${file.name}`; previewFile.style.display = 'block'; }
    }

    if (previewContainer) previewContainer.style.display = 'block';
  };

  document.getElementById('postPhotoInput')?.addEventListener('change', (e) => handlePostFileSelect(e.target.files[0]));
  document.getElementById('postFileInput')?.addEventListener('change', (e) => handlePostFileSelect(e.target.files[0]));

  // Submit New Post
  document.getElementById('createPostSubmitBtn')?.addEventListener('click', async () => {
    const postText = document.getElementById('postText');
    const content = postText ? postText.value.trim() : '';

    if (!content && !currentPostFile) {
      showToast('Please type a message or attach a file.');
      return;
    }

    if (!currentUser) {
      showToast('Please log in to share posts.');
      return;
    }

    const submitBtn = document.getElementById('createPostSubmitBtn');
    if (submitBtn) submitBtn.disabled = true;

    try {
      let attachmentUrl = null;
      let attachmentType = null;

      if (currentPostFile) {
        showToast('Uploading attachment...');
        attachmentUrl = await uploadMediaFile(currentPostFile, 'posts');
        if (currentPostFile.type.startsWith('image/')) attachmentType = 'image';
        else if (currentPostFile.type.startsWith('video/')) attachmentType = 'video';
        else if (currentPostFile.type.startsWith('audio/')) attachmentType = 'audio';
        else attachmentType = 'file';
      }

      const postsRef = ref(database, 'posts');
      await push(postsRef, {
        uid: currentUser.uid,
        author: currentUser.displayName,
        authorName: currentUser.displayName,
        authorEmail: currentUser.email,
        authorAvatarUrl: currentUser.avatarUrl || null,
        content: content,
        attachment: attachmentUrl,
        attachmentType: attachmentType,
        attachmentName: currentPostFile ? currentPostFile.name : null,
        createdAt: Date.now()
      });

      if (postText) postText.value = '';
      window.clearPostPreview();
      showToast('Post published!');
    } catch (err) {
      console.error('Failed to publish post:', err);
      showToast('Failed to post message.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  // Chat Send Input & Events
  const chatInput = document.getElementById('chatInput');
  const chatSendBtn = document.getElementById('chatSendBtn');

  chatInput?.addEventListener('input', () => window.triggerTypingStatus());
  chatInput?.addEventListener('focus', () => { lastFocusedInput = chatInput; });
  document.getElementById('postText')?.addEventListener('focus', function() { lastFocusedInput = this; });

  const handleChatSend = async () => {
    if (!chatInput || !activeChatRoom || !currentUser) return;
    const text = chatInput.value.trim();
    if (!text && !currentChatFile) return;

    try {
      let attachmentUrl = null;
      let attachmentType = null;

      if (currentChatFile) {
        attachmentUrl = await uploadMediaFile(currentChatFile, 'chats');
        attachmentType = currentChatFile.type.startsWith('image/') ? 'image' : 'file';
      }

      const chatRoomRef = ref(database, `chats/${activeChatRoom}`);
      await push(chatRoomRef, {
        senderUid: currentUser.uid,
        senderName: currentUser.displayName,
        text: text,
        attachment: attachmentUrl,
        attachmentType: attachmentType,
        attachmentName: currentChatFile ? currentChatFile.name : null,
        createdAt: Date.now(),
        read: false
      });

      chatInput.value = '';
      window.clearChatPreview();

      if (activeChatRecipientUid) {
        sendNotification(activeChatRecipientUid, currentUser.displayName, 'sent you a direct message.', 'fa-comment');
      }
    } catch (err) {
      console.error('Failed to send chat message:', err);
    }
  };

  chatSendBtn?.addEventListener('click', handleChatSend);
  chatInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleChatSend();
  });

  // Call Controls
  document.getElementById('voiceCallTrigger')?.addEventListener('click', () => window.startCall(false));
  document.getElementById('videoCallTrigger')?.addEventListener('click', () => window.startCall(true));
  document.getElementById('callEndBtn')?.addEventListener('click', () => window.endCall());
  document.getElementById('chatCloseBtn')?.addEventListener('click', () => {
    document.getElementById('chatPopup')?.classList.add('hidden');
  });

  // Clear Call History
  document.getElementById('clearCallHistoryBtn')?.addEventListener('click', async () => {
    if (!currentUser || !confirm('Are you sure you want to clear call history?')) return;
    try {
      await remove(ref(database, `calls/${currentUser.uid}`));
      showToast('Call history cleared.');
    } catch (err) {
      console.error('Failed to clear call history:', err);
    }
  });

  // Save Settings
  document.getElementById('saveSettingsBtn')?.addEventListener('click', async () => {
    if (!currentUser) return;
    const newName = document.getElementById('settingsNameInput')?.value.trim();
    const picFile = document.getElementById('profilePicInput')?.files[0];

    try {
      let avatarUrl = currentUser.avatarUrl;
      if (picFile) {
        showToast('Uploading profile picture...');
        avatarUrl = await uploadMediaFile(picFile, 'avatars');
      }

      if (newName) {
        await updateProfile(auth.currentUser, { displayName: newName });
        currentUser.displayName = newName;
        currentUser.name = newName;
      }
      if (avatarUrl) currentUser.avatarUrl = avatarUrl;

      await update(ref(database, `users/${currentUser.uid}`), {
        displayName: currentUser.displayName,
        name: currentUser.displayName,
        avatarUrl: currentUser.avatarUrl || null
      });

      showToast('Profile updated!');
    } catch (err) {
      console.error('Failed to update settings:', err);
      showToast('Error updating profile.');
    }
  });

  // Enable Notifications
  document.getElementById('enablePushBtn')?.addEventListener('click', async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        showToast('Desktop alerts enabled!');
      } else {
        showToast('Desktop alert permission denied.');
      }
    }
  });

  // Dark/Light Theme Toggle
  document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme');
    const isDark = document.body.classList.contains('dark-theme');
    const btn = document.getElementById('themeToggleBtn');
    if (btn) btn.innerHTML = isDark ? '<i class="fa-solid fa-sun"></i> Light Mode' : '<i class="fa-solid fa-moon"></i> Dark Mode';
  });

  // Back to Top Button
  const backToTopBtn = document.getElementById('backToTopBtn');
  window.addEventListener('scroll', () => {
    if (window.scrollY > 300) backToTopBtn?.classList.remove('hidden');
    else backToTopBtn?.classList.add('hidden');
  });
  backToTopBtn?.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // Search Action
  document.getElementById('searchActionBtn')?.addEventListener('click', () => {
    renderFeed(getCurrentSearchQuery());
  });
  document.getElementById('searchInput')?.addEventListener('input', () => {
    renderFeed(getCurrentSearchQuery());
  });

  // Lightbox Close Handlers
  document.getElementById('closeProfileModalBtn')?.addEventListener('click', () => {
    document.getElementById('profileModal')?.classList.add('hidden');
  });
  document.getElementById('closeLightboxModalBtn')?.addEventListener('click', () => {
    document.getElementById('avatarLightboxModal')?.classList.add('hidden');
  });
  document.getElementById('toastCloseBtn')?.addEventListener('click', () => {
    document.getElementById('toastNotice').style.display = 'none';
  });

  // Profile triggers from top bar & drawer
  document.getElementById('topBarUserProfile')?.addEventListener('click', () => {
    if (currentUser) window.openUserProfile(currentUser.uid);
  });
  document.getElementById('drawerProfileInfo')?.addEventListener('click', () => {
    closeDrawer();
    if (currentUser) window.openUserProfile(currentUser.uid);
  });
});